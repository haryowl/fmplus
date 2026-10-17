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
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Galileosky Easy/Main TCP (header 0x01 tag packets).
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[galileosky] listening on %s (status=partial)", addr)
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
		go handleConn(ctx, conn, st, sessions)
	}
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store, sessions *protocol.Registry) {
	metrics.ConnOpen()
	var bound *protocol.ConnSession
	defer func() {
		metrics.ConnClose()
		if sessions != nil && bound != nil {
			sessions.Unbind(bound)
		}
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
		if length < 2 {
			continue
		}
		payload := body[:length-1]
		payload, compressed := maybeDecompress(hdr[0], payload)
		if compressed {
			log.Printf("[galileosky] compressed packet from %s (experimental — ack only)", conn.RemoteAddr())
			if device != nil {
				_ = st.TouchSeen(ctx, device)
			}
			_ = writeAck(conn)
			continue
		}
		tags := parseTags(payload)
		if v, ok := tags[0x03]; ok && len(v) >= 15 {
			imei = string(v[:15])
			device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "galileosky")
			if device != nil && sessions != nil && bound == nil {
				bound = &protocol.ConnSession{
					DeviceID: device.ID, IMEI: device.IMEI, Protocol: "galileosky", Conn: conn,
				}
				sessions.Bind(bound)
			}
		}
		fix, hasFix := fixFromTags(tags)
		if hasFix && device == nil && imei != "" {
			device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "galileosky")
			if device != nil && sessions != nil && bound == nil {
				bound = &protocol.ConnSession{
					DeviceID: device.ID, IMEI: device.IMEI, Protocol: "galileosky", Conn: conn,
				}
				sessions.Bind(bound)
			}
		}
		if hasFix && device != nil {
			fix.SourceProtocol = "galileosky"
			if fix.RawAttrs == nil {
				fix.RawAttrs = map[string]any{}
			}
			fix.RawAttrs["tags"] = tagsToRaw(tags)
			if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
				log.Printf("[galileosky] ingest %s: %v", imei, err)
			}
		} else if device != nil && !hasFix {
			_ = st.TouchSeen(ctx, device)
		}
		_ = writeAck(conn)
	}
}

func writeAck(conn net.Conn) error {
	_, err := conn.Write([]byte{0x02, 0x00, 0x00})
	return err
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
		spd := float64(sc[0])
		hdg := float64(sc[1]) * 2
		fix.Speed = &spd
		fix.Heading = &hdg
	}
	if din, ok := tags[0x01]; ok && len(din) >= 1 {
		b := din[0]&0x01 != 0
		fix.Ignition = &b
	}
	if odo, ok := tags[0xd4]; ok && len(odo) >= 4 {
		f := float64(binary.LittleEndian.Uint32(odo)) / 1000.0
		fix.Odometer = &f
	}
	return fix, true
}
