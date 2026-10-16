package teltonika

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

// Serve Teltonika Codec 8 / 8 Extended AVL over TCP.
func Serve(ctx context.Context, addr string, st *store.Store) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[teltonika] listening on %s", addr)
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
				log.Printf("[teltonika] accept: %v", err)
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
	_ = conn.SetDeadline(time.Now().Add(2 * time.Minute))

	imeiLenBuf := make([]byte, 2)
	if _, err := io.ReadFull(conn, imeiLenBuf); err != nil {
		return
	}
	imeiLen := int(binary.BigEndian.Uint16(imeiLenBuf))
	if imeiLen < 5 || imeiLen > 32 {
		_, _ = conn.Write([]byte{0x00})
		return
	}
	imeiBuf := make([]byte, imeiLen)
	if _, err := io.ReadFull(conn, imeiBuf); err != nil {
		return
	}
	imei := string(imeiBuf)

	device := deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "teltonika")
	if device == nil {
		_, _ = conn.Write([]byte{0x00})
		return
	}
	if _, err := conn.Write([]byte{0x01}); err != nil {
		return
	}

	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		preamble := make([]byte, 4)
		if _, err := io.ReadFull(conn, preamble); err != nil {
			return
		}
		if binary.BigEndian.Uint32(preamble) != 0 {
			return
		}
		lenBuf := make([]byte, 4)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return
		}
		dataLen := int(binary.BigEndian.Uint32(lenBuf))
		if dataLen < 1 || dataLen > 128*1024 {
			return
		}
		payload := make([]byte, dataLen)
		if _, err := io.ReadFull(conn, payload); err != nil {
			return
		}
		crcBuf := make([]byte, 4)
		if _, err := io.ReadFull(conn, crcBuf); err != nil {
			return
		}

		count, fixes := parseAVL(payload)
		for _, fix := range fixes {
			fix.SourceProtocol = "teltonika"
			if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
				log.Printf("[teltonika] ingest %s: %v", imei, err)
			}
		}
		ack := make([]byte, 4)
		binary.BigEndian.PutUint32(ack, uint32(count))
		if _, err := conn.Write(ack); err != nil {
			return
		}
	}
}

func parseAVL(payload []byte) (int, []store.Fix) {
	if len(payload) < 2 {
		return 0, nil
	}
	codec := payload[0]
	n := int(payload[1])
	if n == 0 {
		return 0, nil
	}
	off := 2
	var fixes []store.Fix
	for i := 0; i < n && off+24 <= len(payload); i++ {
		tsMs := int64(binary.BigEndian.Uint64(payload[off : off+8]))
		off += 8
		off++ // priority
		if off+15 > len(payload) {
			break
		}
		lonRaw := int32(binary.BigEndian.Uint32(payload[off : off+4]))
		off += 4
		latRaw := int32(binary.BigEndian.Uint32(payload[off : off+4]))
		off += 4
		alt := int16(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2
		angle := int(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2
		sats := int(payload[off])
		off++
		speed := int(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2

		lon := float64(lonRaw) / 1e7
		lat := float64(latRaw) / 1e7
		spd := float64(speed)
		hdg := float64(angle)
		altF := float64(alt)
		fix := store.Fix{
			Lat:        lat,
			Lon:        lon,
			RecordedAt: time.UnixMilli(tsMs).UTC(),
			Speed:      &spd,
			Heading:    &hdg,
			Altitude:   &altF,
			Satellites: &sats,
			RawAttrs:   map[string]any{"codec": codec},
		}

		// IO elements — skip by codec layout so we can continue the record loop.
		if codec == 0x08 {
			off = skipIO8(payload, off)
		} else if codec == 0x8e {
			off = skipIO8E(payload, off)
		} else {
			// Unknown codec: accept first record coords and stop.
			fixes = append(fixes, fix)
			break
		}
		fixes = append(fixes, fix)
	}
	return n, fixes
}

func skipIO8(b []byte, off int) int {
	if off >= len(b) {
		return off
	}
	off++ // event IO id
	off++ // total IO
	off = skipSized(b, off, 1)
	off = skipSized(b, off, 2)
	off = skipSized(b, off, 4)
	off = skipSized(b, off, 8)
	return off
}

func skipIO8E(b []byte, off int) int {
	if off+2 > len(b) {
		return off
	}
	off += 2 // event IO id u16
	if off+2 > len(b) {
		return off
	}
	off += 2 // total IO u16
	off = skipSizedU16(b, off, 1)
	off = skipSizedU16(b, off, 2)
	off = skipSizedU16(b, off, 4)
	off = skipSizedU16(b, off, 8)
	// NX variable length
	if off+2 > len(b) {
		return off
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	for i := 0; i < n && off+4 <= len(b); i++ {
		off += 2 // id
		l := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		off += l
	}
	return off
}

func skipSized(b []byte, off, size int) int {
	if off >= len(b) {
		return off
	}
	n := int(b[off])
	off++
	off += n * (1 + size)
	return off
}

func skipSizedU16(b []byte, off, size int) int {
	if off+2 > len(b) {
		return off
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	off += n * (2 + size)
	return off
}
