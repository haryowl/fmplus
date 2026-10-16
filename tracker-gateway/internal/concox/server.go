package concox

import (
	"context"
	"encoding/binary"
	"io"
	"log"
	"math"
	"net"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Concox / GT06-family TCP (login 0x01, GPS 0x12/0x22, heartbeat 0x13).
func Serve(ctx context.Context, addr string, st *store.Store) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[concox] listening on %s", addr)
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
				log.Printf("[concox] accept: %v", err)
				continue
			}
		}
		go handleConn(ctx, conn, st)
	}
}

func handleConn(ctx context.Context, conn net.Conn, st *store.Store) {
	defer conn.Close()
	var device *store.Device
	var imei string
	buf := make([]byte, 0, 2048)
	tmp := make([]byte, 1024)
	for {
		_ = conn.SetDeadline(time.Now().Add(5 * time.Minute))
		n, err := conn.Read(tmp)
		if err != nil {
			return
		}
		buf = append(buf, tmp[:n]...)
		for {
			frame, rest, ok := takeFrame(buf)
			buf = rest
			if !ok {
				break
			}
			proto, info, serial, err := decodeFrame(frame)
			if err != nil {
				continue
			}
			switch proto {
			case 0x01: // login
				imei = bcdIMEI(info)
				if imei == "" {
					continue
				}
				d, err := st.FindByIMEI(ctx, imei)
				if err != nil {
					log.Printf("[concox] unknown IMEI %s", imei)
					continue
				}
				device = d
				_ = writeReply(conn, 0x01, serial, nil)
			case 0x13: // heartbeat / status
				_ = writeReply(conn, 0x13, serial, nil)
			case 0x12, 0x22: // GPS location
				if device == nil && imei != "" {
					if d, err := st.FindByIMEI(ctx, imei); err == nil {
						device = d
					}
				}
				if device != nil {
					if fix, ok := parseGPS(info, proto); ok {
						fix.SourceProtocol = "concox"
						if err := st.Ingest(ctx, device, fix); err != nil {
							log.Printf("[concox] ingest %s: %v", imei, err)
						}
					}
				}
				_ = writeReply(conn, proto, serial, nil)
			case 0x16: // alarm (often includes GPS)
				if device != nil {
					if fix, ok := parseGPS(info, proto); ok {
						fix.SourceProtocol = "concox"
						_ = st.Ingest(ctx, device, fix)
					}
				}
				_ = writeReply(conn, 0x16, serial, nil)
			default:
				_ = writeReply(conn, proto, serial, nil)
			}
		}
		if len(buf) > 64*1024 {
			return
		}
	}
}

func takeFrame(buf []byte) (frame []byte, rest []byte, ok bool) {
	for i := 0; i+5 < len(buf); i++ {
		if buf[i] == 0x78 && buf[i+1] == 0x78 {
			packetLen := int(buf[i+2])
			total := 2 + 1 + packetLen + 2 // start + len + content + stop
			if i+total > len(buf) {
				return nil, buf[i:], false
			}
			if buf[i+total-2] != 0x0d || buf[i+total-1] != 0x0a {
				continue
			}
			return buf[i : i+total], buf[i+total:], true
		}
		if buf[i] == 0x79 && buf[i+1] == 0x79 {
			if i+4 >= len(buf) {
				return nil, buf[i:], false
			}
			packetLen := int(binary.BigEndian.Uint16(buf[i+2 : i+4]))
			total := 2 + 2 + packetLen + 2
			if i+total > len(buf) {
				return nil, buf[i:], false
			}
			if buf[i+total-2] != 0x0d || buf[i+total-1] != 0x0a {
				continue
			}
			return buf[i : i+total], buf[i+total:], true
		}
	}
	if len(buf) > 2 {
		return nil, nil, false
	}
	return nil, buf, false
}

func decodeFrame(frame []byte) (proto byte, info []byte, serial uint16, err error) {
	if len(frame) < 10 {
		return 0, nil, 0, io.ErrUnexpectedEOF
	}
	var content []byte
	if frame[0] == 0x78 && frame[1] == 0x78 {
		plen := int(frame[2])
		content = frame[3 : 3+plen]
	} else {
		plen := int(binary.BigEndian.Uint16(frame[2:4]))
		content = frame[4 : 4+plen]
	}
	if len(content) < 5 {
		return 0, nil, 0, io.ErrUnexpectedEOF
	}
	proto = content[0]
	// content = proto + info + serial(2) + crc(2)
	serial = binary.BigEndian.Uint16(content[len(content)-4 : len(content)-2])
	info = content[1 : len(content)-4]
	return proto, info, serial, nil
}

func writeReply(conn net.Conn, proto byte, serial uint16, extra []byte) error {
	// 78 78 | len | proto | [extra] | serial | crc | 0D 0A
	body := make([]byte, 0, 8+len(extra))
	body = append(body, proto)
	body = append(body, extra...)
	ser := make([]byte, 2)
	binary.BigEndian.PutUint16(ser, serial)
	body = append(body, ser...)
	crcIn := append([]byte{byte(1 + len(extra) + 2 + 2)}, body...)
	// CRC over packet length through serial number (Concox docs)
	sum := crc16ITU(crcIn)
	out := []byte{0x78, 0x78, byte(len(body) + 2)}
	out = append(out, body...)
	crcBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(crcBuf, sum)
	out = append(out, crcBuf...)
	out = append(out, 0x0d, 0x0a)
	_, err := conn.Write(out)
	return err
}

func crc16ITU(data []byte) uint16 {
	var crc uint16 = 0xFFFF
	for _, b := range data {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc & 0xFFFF
}

func bcdIMEI(info []byte) string {
	if len(info) < 8 {
		return ""
	}
	const hex = "0123456789"
	out := make([]byte, 0, 16)
	// First nibble of first byte is often 0 padding
	for i := 0; i < 8; i++ {
		hi := info[i] >> 4
		lo := info[i] & 0x0f
		if hi < 10 {
			out = append(out, hex[hi])
		}
		if lo < 10 {
			out = append(out, hex[lo])
		}
	}
	s := string(out)
	for len(s) > 0 && s[0] == '0' && len(s) > 15 {
		s = s[1:]
	}
	// Prefer 15-digit IMEI when present
	if len(s) >= 15 {
		return s[len(s)-15:]
	}
	return s
}

func parseGPS(info []byte, proto byte) (store.Fix, bool) {
	// 0x12: datetime(6) + gpsLen(1) + qty(1) + lat(4) + lon(4) + speed(1) + course(2) + …
	// 0x22 similar with slightly different MCC fields
	off := 0
	if proto == 0x16 && len(info) > 6 {
		// alarm packets often prepend terminal info; try to find datetime-like GPS block
		off = 0
	}
	if len(info) < off+18 {
		return store.Fix{}, false
	}
	ts := parseDateTime(info[off : off+6])
	off += 6
	if off >= len(info) {
		return store.Fix{}, false
	}
	off++ // gps info length
	if off >= len(info) {
		return store.Fix{}, false
	}
	sats := int(info[off] & 0x0f)
	off++
	if off+10 > len(info) {
		return store.Fix{}, false
	}
	latRaw := binary.BigEndian.Uint32(info[off : off+4])
	off += 4
	lonRaw := binary.BigEndian.Uint32(info[off : off+4])
	off += 4
	speed := float64(info[off])
	off++
	courseStatus := binary.BigEndian.Uint16(info[off : off+2])
	lat := float64(latRaw) / 1800000.0
	lon := float64(lonRaw) / 1800000.0
	if courseStatus&0x0400 == 0 { // south bit clear means south in some docs — Concox: bit 2 of course byte
		// Course/status: bit10 = lat hemisphere (1=north), bit11 = lon (1=west) — GT06 variant
	}
	// GT06: bit 2 of high course byte: 1 = north, 0 = south; bit 3: 1 = west, 0 = east
	if courseStatus&0x0400 == 0 {
		lat = -math.Abs(lat)
	}
	if courseStatus&0x0800 != 0 {
		lon = -math.Abs(lon)
	}
	hdg := float64(courseStatus & 0x03FF)
	return store.Fix{
		Lat:            lat,
		Lon:            lon,
		RecordedAt:     ts,
		Speed:          &speed,
		Heading:        &hdg,
		Satellites:     &sats,
		RawAttrs:       map[string]any{"proto": proto},
		SourceProtocol: "concox",
	}, true
}

func parseDateTime(b []byte) time.Time {
	if len(b) < 6 {
		return time.Now().UTC()
	}
	year := 2000 + int(b[0])
	month := int(b[1])
	day := int(b[2])
	hour := int(b[3])
	min := int(b[4])
	sec := int(b[5])
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return time.Now().UTC()
	}
	return time.Date(year, time.Month(month), day, hour, min, sec, 0, time.UTC)
}
