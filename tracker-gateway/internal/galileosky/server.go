package galileosky

import (
	"context"
	"encoding/binary"
	"io"
	"log"
	"net"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Galileosky Easy/Main TCP (header 0x01 tag packets).
func Serve(ctx context.Context, addr string, st *store.Store) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[galileosky] listening on %s", addr)
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				log.Printf("[galileosky] accept: %v", err)
				continue
			}
		}
		go handleConn(ctx, conn, st)
	}
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store) {
	metrics.ConnOpen()
	defer func() {
		metrics.ConnClose()
		_ = conn.Close()
	}()
	var device *store.Device
	var imei string
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		hdr := make([]byte, 3)
		if _, err := io.ReadFull(conn, hdr); err != nil {
			return
		}
		if hdr[0] != 0x01 {
			// resync: seek next 0x01
			continue
		}
		length := int(binary.LittleEndian.Uint16(hdr[1:3]))
		if length < 1 || length > 64*1024 {
			return
		}
		body := make([]byte, length)
		if _, err := io.ReadFull(conn, body); err != nil {
			return
		}
		// body includes payload tags + 1 checksum byte at end
		if length < 2 {
			continue
		}
		payload := body[:length-1]
		tags := parseTags(payload)
		if v, ok := tags[0x03]; ok && len(v) >= 15 {
			imei = string(v[:15])
			device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "galileosky")
		}
		fix, hasFix := fixFromTags(tags)
		if hasFix && device == nil && imei != "" {
			device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "galileosky")
		}
		if hasFix && device != nil {
			fix.SourceProtocol = "galileosky"
			if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
				log.Printf("[galileosky] ingest %s: %v", imei, err)
			}
		}
		_ = writeAck(conn)
	}
}

func writeAck(conn net.Conn) error {
	// Empty confirm: 0x02 | len=0
	_, err := conn.Write([]byte{0x02, 0x00, 0x00})
	return err
}

func parseTags(payload []byte) map[byte][]byte {
	out := make(map[byte][]byte)
	off := 0
	for off < len(payload) {
		tag := payload[off]
		off++
		size := tagSize(tag)
		if size < 0 {
			// variable / unknown — stop
			break
		}
		if off+size > len(payload) {
			break
		}
		out[tag] = append([]byte(nil), payload[off:off+size]...)
		off += size
	}
	return out
}

func tagSize(tag byte) int {
	switch tag {
	case 0x01, 0x02, 0x04, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
		0x18, 0x19, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46:
		return 1
	case 0x20, 0x33, 0x34, 0x35, 0x50, 0x51, 0x52, 0x53, 0x58:
		return 2
	case 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b,
		0x2c, 0x2d, 0x2e, 0x2f, 0x5a, 0x5b, 0x5c, 0x5d, 0xe1:
		return 4
	case 0x30: // coords: lat4 + lon4 + sats1? — Galileosky uses 9 bytes
		return 9
	case 0x03: // IMEI
		return 15
	case 0x31, 0x32:
		return 2
	case 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77:
		return 4
	default:
		// 0x5x extended often 4; unknown tags break the walk
		if tag >= 0x50 && tag <= 0x57 {
			return 2
		}
		if tag >= 0x60 && tag <= 0x6f {
			return 4
		}
		return -1
	}
}

func fixFromTags(tags map[byte][]byte) (store.Fix, bool) {
	coords, ok := tags[0x30]
	if !ok || len(coords) < 8 {
		return store.Fix{}, false
	}
	latRaw := int32(binary.LittleEndian.Uint32(coords[0:4]))
	lonRaw := int32(binary.LittleEndian.Uint32(coords[4:8]))
	lat := float64(latRaw) / 1_000_000.0
	lon := float64(lonRaw) / 1_000_000.0
	var sats *int
	if len(coords) >= 9 {
		n := int(coords[8])
		sats = &n
	}
	var recorded time.Time
	if dt, ok := tags[0x20]; ok && len(dt) >= 4 {
		// Some firmwares: unix seconds LE; others: different — accept unix if plausible
		sec := binary.LittleEndian.Uint32(dt[0:4])
		if sec > 1_000_000_000 && sec < 4_000_000_000 {
			recorded = time.Unix(int64(sec), 0).UTC()
		}
	}
	if recorded.IsZero() {
		recorded = time.Now().UTC()
	}
	fix := store.Fix{
		Lat:            lat,
		Lon:            lon,
		RecordedAt:     recorded,
		Satellites:     sats,
		SourceProtocol: "galileosky",
		RawAttrs:       map[string]any{},
	}
	if sc, ok := tags[0x33]; ok && len(sc) >= 2 {
		// speed 1 byte km/h, course 1 byte * 2 degrees — common Easy layout
		spd := float64(sc[0])
		hdg := float64(sc[1]) * 2
		fix.Speed = &spd
		fix.Heading = &hdg
	}
	return fix, true
}
