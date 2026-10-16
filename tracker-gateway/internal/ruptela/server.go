package ruptela

import (
	"context"
	"encoding/binary"
	"io"
	"log"
	"net"
	"strconv"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Ruptela FM TCP (records packet id 1, ACK id 100).
func Serve(ctx context.Context, addr string, st *store.Store) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[ruptela] listening on %s", addr)
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
				log.Printf("[ruptela] accept: %v", err)
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
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		lenBuf := make([]byte, 2)
		if _, err := io.ReadFull(conn, lenBuf); err != nil {
			return
		}
		length := int(binary.BigEndian.Uint16(lenBuf))
		if length < 1 || length > 64*1024 {
			return
		}
		payload := make([]byte, length+2) // data + crc
		if _, err := io.ReadFull(conn, payload); err != nil {
			return
		}
		data := payload[:length]
		// crc := binary.BigEndian.Uint16(payload[length:]) — accepted without strict check for dialect drift
		if len(data) < 1 {
			continue
		}
		packetID := data[0]
		switch packetID {
		case 1: // records
			records, imei := parseRecords(data[1:])
			if imei == "" {
				continue
			}
			device := deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "ruptela")
			if device == nil {
				_ = writeAck(conn, 0)
				continue
			}
			for _, fix := range records {
				fix.SourceProtocol = "ruptela"
				if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
					log.Printf("[ruptela] ingest %s: %v", imei, err)
				}
			}
			_ = writeAck(conn, len(records))
		case 7: // dynamic records / extended — treat similarly when possible
			records, imei := parseRecords(data[1:])
			if imei != "" {
				if device := deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "ruptela"); device != nil {
					for _, fix := range records {
						fix.SourceProtocol = "ruptela"
						_ = deviceauth.Ingest(ctx, st, device, fix)
					}
					_ = writeAck(conn, len(records))
					continue
				}
			}
			_ = writeAck(conn, 0)
		default:
			_ = writeAck(conn, 0)
		}
	}
}

func writeAck(conn net.Conn, count int) error {
	// length=3, packet id=100, records received (uint16 BE), crc
	body := []byte{100, 0, 0}
	binary.BigEndian.PutUint16(body[1:3], uint16(count))
	crc := crc16IBM(append([]byte{0, 3}, body...))
	out := make([]byte, 0, 7)
	out = append(out, 0, 3)
	out = append(out, body...)
	crcBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(crcBuf, crc)
	out = append(out, crcBuf...)
	_, err := conn.Write(out)
	return err
}

func crc16IBM(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

func parseRecords(data []byte) ([]store.Fix, string) {
	if len(data) < 8 {
		return nil, ""
	}
	imeiNum := binary.BigEndian.Uint64(data[0:8])
	imei := strconv.FormatUint(imeiNum, 10)
	off := 8
	if off >= len(data) {
		return nil, imei
	}
	// some firmwares insert a records-left / flags byte
	count := int(data[off])
	off++
	var fixes []store.Fix
	for i := 0; i < count && off+30 <= len(data); i++ {
		ts := int64(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		// timestamp is unix seconds on classic Ruptela
		lonRaw := int32(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		latRaw := int32(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		// altitude int16, angle uint16, satellites, speed — order varies; use common FM layout:
		// altitude(2) angle(2) satellites(1) speed(2) then IO
		if off+7 > len(data) {
			break
		}
		alt := int16(binary.BigEndian.Uint16(data[off : off+2]))
		off += 2
		angle := binary.BigEndian.Uint16(data[off : off+2])
		off += 2
		sats := int(data[off])
		off++
		speed := binary.BigEndian.Uint16(data[off : off+2])
		off += 2
		// skip event IO id + IO elements roughly (1 + variable) — consume remaining until next record heuristically
		if off < len(data) {
			// eventIO (1) + N1 + N2*2 + N4*4 + N8*8
			off = skipRuptelaIO(data, off)
		}
		lon := float64(lonRaw) / 1e7
		lat := float64(latRaw) / 1e7
		spd := float64(speed)
		hdg := float64(angle)
		altF := float64(alt)
		fixes = append(fixes, store.Fix{
			Lat:            lat,
			Lon:            lon,
			RecordedAt:     time.Unix(ts, 0).UTC(),
			Speed:          &spd,
			Heading:        &hdg,
			Altitude:       &altF,
			Satellites:     &sats,
			SourceProtocol: "ruptela",
			RawAttrs:       map[string]any{},
		})
	}
	return fixes, imei
}

func skipRuptelaIO(b []byte, off int) int {
	if off >= len(b) {
		return off
	}
	off++ // event IO id
	if off >= len(b) {
		return off
	}
	n1 := int(b[off])
	off++
	off += n1 * 2 // id(1)+value(1) — some use id+val; ruptela uses id(1)+val(1) for 1-byte
	if off >= len(b) {
		return off
	}
	n2 := int(b[off])
	off++
	off += n2 * 3
	if off >= len(b) {
		return off
	}
	n4 := int(b[off])
	off++
	off += n4 * 5
	if off >= len(b) {
		return off
	}
	n8 := int(b[off])
	off++
	off += n8 * 9
	return off
}
