package concox

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Concox / GT06-family TCP (login 0x01, GPS 0x12/0x22, heartbeat 0x13).
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[concox] listening on %s (status=partial)", addr)
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
	var downSerial uint16 = 1
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
				device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "concox")
				if device == nil {
					continue
				}
				bound = &protocol.ConnSession{
					DeviceID: device.ID, IMEI: device.IMEI, Protocol: "concox", Conn: conn,
					Meta: map[string]string{"seq": fmt.Sprintf("%d", downSerial)},
				}
				if sessions != nil {
					sessions.Bind(bound)
				}
				_ = writeReply(conn, 0x01, serial, nil)
			case 0x13: // heartbeat / status
				if device != nil {
					patch, ign := parseHeartbeat(info)
					_ = st.PatchLastStatus(ctx, device, patch, ign)
					flushPending(ctx, conn, st, device.ID, &downSerial, bound)
				}
				_ = writeReply(conn, 0x13, serial, nil)
			case 0x12, 0x22, 0x17: // GPS location / offline GPS re-upload
				if device == nil && imei != "" {
					device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "concox")
				}
				if device != nil {
					if fix, ok := parseGPS(info, proto); ok {
						fix.SourceProtocol = "concox"
						if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
							log.Printf("[concox] ingest %s: %v", imei, err)
						}
					}
					flushPending(ctx, conn, st, device.ID, &downSerial, bound)
				}
				_ = writeReply(conn, proto, serial, nil)
			case 0x18: // LBS-only (no GPS fix — patch cell attrs)
				if device != nil {
					_ = st.PatchLastStatus(ctx, device, parseLBS(info), nil)
					flushPending(ctx, conn, st, device.ID, &downSerial, bound)
				}
				_ = writeReply(conn, 0x18, serial, nil)
			case 0x15, 0x21: // string / online command response from terminal
				if device != nil {
					resp := string(info)
					if len(info) > 1 {
						// common: len byte + ascii
						n := int(info[0])
						if n > 0 && 1+n <= len(info) {
							resp = string(info[1 : 1+n])
						}
					}
					// Prefer corr by uplink serial when device echoes server serial; else latest.
					_ = st.AckCommand(ctx, device.ID, fmt.Sprintf("%d", serial), true, resp)
					_ = st.TouchSeen(ctx, device)
					flushPending(ctx, conn, st, device.ID, &downSerial, bound)
				}
				_ = writeReply(conn, proto, serial, nil)
			case 0x8a: // time calibration request (GT06 family)
				if device != nil {
					_ = st.TouchSeen(ctx, device)
				}
				now := time.Now().UTC()
				cal := []byte{
					byte(now.Year() - 2000),
					byte(now.Month()),
					byte(now.Day()),
					byte(now.Hour()),
					byte(now.Minute()),
					byte(now.Second()),
				}
				_ = writeReply(conn, 0x8a, serial, cal)
			case 0x94: // general info transmission
				if device != nil {
					_ = st.PatchLastStatus(ctx, device, decodeInfo94(info), nil)
					flushPending(ctx, conn, st, device.ID, &downSerial, bound)
				}
				_ = writeReply(conn, 0x94, serial, nil)
			case 0x16: // alarm (often includes GPS)
				if device != nil {
					if fix, ok := parseGPS(info, proto); ok {
						fix.SourceProtocol = "concox"
						applyAlarmAttrs(info, fix.RawAttrs)
						_ = deviceauth.Ingest(ctx, st, device, fix)
						if ev := safetyFromAlarm(info, fix); ev != nil {
							_ = st.InsertSafetyEvent(ctx, device, *ev)
						}
					} else if ev := safetyFromAlarm(info, store.Fix{RecordedAt: time.Now().UTC()}); ev != nil {
						_ = st.InsertSafetyEvent(ctx, device, *ev)
					}
					flushPending(ctx, conn, st, device.ID, &downSerial, bound)
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

func flushPending(ctx context.Context, conn net.Conn, st *store.Store, deviceID string, serial *uint16, bound *protocol.ConnSession) {
	enc := Adapter{}
	for i := 0; i < 4; i++ {
		cmd, err := st.NextPendingCommand(ctx, deviceID)
		if err != nil || cmd == nil {
			return
		}
		var ser uint16 = 1
		if serial != nil {
			if *serial == 0 {
				*serial = 1
			}
			ser = *serial
			*serial++
		}
		payload, err := enc.EncodeDownlinkSerial(*cmd, ser)
		if err != nil || len(payload) == 0 {
			return
		}
		if _, err := conn.Write(payload); err != nil {
			return
		}
		_ = st.MarkCommandSentCorr(ctx, cmd.ID, fmt.Sprintf("%d", ser))
		if bound != nil {
			if bound.Meta == nil {
				bound.Meta = map[string]string{}
			}
			bound.Meta["seq"] = fmt.Sprintf("%d", ser)
		}
	}
}

func writeReply(conn net.Conn, proto byte, serial uint16, extra []byte) error {
	// Same framing as downlink (0x7878 or extended 0x7979 when large).
	_, err := conn.Write(buildFrame(proto, serial, extra))
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
	// 0x12/0x22: datetime(6)+gpsLen+qty+lat+lon+speed+course…
	// 0x16 alarm often prepends terminal-info/LBS — scan for a plausible GPS block.
	if proto == 0x16 {
		for off := 0; off+18 <= len(info); off++ {
			if !looksLikeDateTime(info[off : off+6]) {
				continue
			}
			if fix, ok := parseGPSAt(info, off, proto); ok {
				return fix, true
			}
		}
		return store.Fix{}, false
	}
	return parseGPSAt(info, 0, proto)
}

func looksLikeDateTime(b []byte) bool {
	if len(b) < 6 {
		return false
	}
	// GT06: year = year-2000 (0–99), month 1–12, day 1–31, h/m/s clock range
	m, d, h, mi, s := int(b[1]), int(b[2]), int(b[3]), int(b[4]), int(b[5])
	return m >= 1 && m <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && s <= 59
}

func parseGPSAt(info []byte, off int, proto byte) (store.Fix, bool) {
	if len(info) < off+18 {
		return store.Fix{}, false
	}
	start := off
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
	// GT06: bit10 = north, bit11 = west
	if courseStatus&0x0400 == 0 {
		lat = -math.Abs(lat)
	}
	if courseStatus&0x0800 != 0 {
		lon = -math.Abs(lon)
	}
	// Reject clearly invalid coordinates (bad offset guess).
	if math.Abs(lat) > 90 || math.Abs(lon) > 180 || (latRaw == 0 && lonRaw == 0) {
		return store.Fix{}, false
	}
	hdg := float64(courseStatus & 0x03FF)
	acc := courseStatus&0x8000 != 0
	status := map[string]any{
		"acc":   acc,
		"north": courseStatus&0x0400 != 0,
		"west":  courseStatus&0x0800 != 0,
	}
	raw := map[string]any{
		"proto":         proto,
		"course_status": courseStatus,
		"status":        status,
		"status.acc":    acc,
		"status.north":  status["north"],
		"status.west":   status["west"],
	}
	if start > 0 {
		raw["gps_offset"] = start
		raw["prefix_hex"] = fmt.Sprintf("%x", info[:start])
	}
	if rem := off + 2; rem < len(info) {
		raw["tail_hex"] = fmt.Sprintf("%x", info[rem:])
		if rem+2 <= len(info) {
			raw["mcc"] = int(binary.BigEndian.Uint16(info[rem : rem+2]))
		}
	}
	fix := store.Fix{
		Lat:            lat,
		Lon:            lon,
		RecordedAt:     ts,
		Speed:          &speed,
		Heading:        &hdg,
		Satellites:     &sats,
		Ignition:       &acc,
		RawAttrs:       raw,
		SourceProtocol: "concox",
	}
	return fix, true
}

// parseLBS extracts MCC/MNC/LAC/CI from GT06 0x18 (layout varies by firmware).
func parseLBS(info []byte) map[string]any {
	patch := map[string]any{"proto": 0x18, "lbs": true, "info_hex": fmt.Sprintf("%x", info)}
	if len(info) >= 9 {
		patch["mcc"] = int(binary.BigEndian.Uint16(info[0:2]))
		patch["mnc"] = int(info[2])
		patch["lac"] = int(binary.BigEndian.Uint16(info[3:5]))
		// 3-byte cell id common on GT06
		ci := int(info[5])<<16 | int(info[6])<<8 | int(info[7])
		patch["cell_id"] = ci
		if len(info) >= 9 {
			patch["rssi"] = int(info[8])
		}
	}
	return patch
}

// decodeInfo94 maps GT06/CMS 0x94 info-type byte to remappable status keys.
func decodeInfo94(info []byte) map[string]any {
	patch := map[string]any{"proto": 0x94, "info_hex": fmt.Sprintf("%x", info)}
	if len(info) < 1 {
		return patch
	}
	typ := info[0]
	patch["info_type"] = int(typ)
	data := info[1:]
	switch typ {
	case 0x00: // external voltage (WORD, 0.01 V) — CMS family
		if len(data) >= 2 {
			mv := float64(binary.BigEndian.Uint16(data[0:2])) * 0.01
			patch["ext_voltage"] = mv
		}
	case 0x04: // terminal status sync
		if len(data) >= 1 {
			patch["terminal_info"] = int(data[0])
			acc := data[0]&0x02 != 0 || data[0]&0x10 != 0
			patch["status.acc"] = acc
		}
	case 0x05: // door / status
		if len(data) >= 1 {
			patch["door"] = int(data[0])
			patch["status.door"] = data[0] != 0
		}
	case 0x0a: // ICCID (ASCII)
		if len(data) > 0 {
			patch["iccid"] = strings.TrimSpace(string(data))
		}
	case 0x0e: // IMSI
		if len(data) > 0 {
			patch["imsi"] = strings.TrimSpace(string(data))
		}
	default:
		if len(data) > 0 {
			patch["info_data_hex"] = fmt.Sprintf("%x", data)
		}
	}
	return patch
}

// parseHeartbeat decodes GT06 0x13 terminal info / voltage / GSM.
func parseHeartbeat(info []byte) (map[string]any, *bool) {
	patch := map[string]any{"proto": 0x13, "heartbeat": true}
	if len(info) < 1 {
		return patch, nil
	}
	term := info[0]
	acc := term&0x02 != 0 // bit1 ACC on common GT06
	if term&0x10 != 0 {   // bit4 ACC on some clones
		acc = true
	}
	patch["status.acc"] = acc
	patch["terminal_info"] = int(term)
	patch["gps_tracking"] = term&0x40 != 0 || term&0x04 != 0
	if len(info) >= 2 {
		patch["voltage_level"] = int(info[1])
	}
	if len(info) >= 3 {
		patch["gsm_signal"] = int(info[2])
	}
	if len(info) >= 4 {
		patch["alarm_lang"] = int(info[3])
	}
	return patch, &acc
}

// GT06 alarm type byte → remappable alarm.* key (protocol PDF / CMSV7 family).
var concoxAlarmNames = map[byte]string{
	0x01: "sos",
	0x02: "power_cut",
	0x03: "vibration",
	0x04: "fence_in",
	0x05: "fence_out",
	0x06: "overspeed",
	0x09: "moving",
	0x0a: "enter_gps",
	0x0b: "gps_lost",
	0x0c: "power_on",
	0x0d: "gps_ok",
	0x0e: "power_off",
	0x13: "remove",
	0x14: "wear",
	0x19: "illegal_move",
	0x23: "fall",
	0x29: "crash",
}

func applyAlarmAttrs(info []byte, raw map[string]any) {
	if raw == nil {
		return
	}
	code, ok := extractAlarmCode(info)
	if !ok {
		return
	}
	name := concoxAlarmNames[code]
	if name == "" {
		name = fmt.Sprintf("0x%02x", code)
	}
	raw["alarm_code"] = int(code)
	raw["alarm."+name] = true
}

func safetyFromAlarm(info []byte, fix store.Fix) *store.SafetyEvent {
	code, ok := extractAlarmCode(info)
	if !ok {
		return nil
	}
	alarmType := concoxAlarmNames[code]
	if alarmType == "" {
		alarmType = fmt.Sprintf("alarm_0x%02x", code)
	}
	lat, lon := fix.Lat, fix.Lon
	level := 1
	if code == 0x01 || code == 0x02 || code == 0x29 {
		level = 2
	}
	raw := map[string]any{
		"alarm_code":  int(code),
		"alarm_level": level,
		"proto":       0x16,
	}
	raw["alarm."+alarmType] = true
	return &store.SafetyEvent{
		RecordedAt:     fix.RecordedAt,
		AlarmType:      alarmType,
		AlarmLevel:     level,
		Lat:            &lat,
		Lon:            &lon,
		RawAttrs:       raw,
		SourceProtocol: "concox",
	}
}

// extractAlarmCode finds GT06 0x16 alarm type byte after GPS+LBS when possible.
func extractAlarmCode(info []byte) (byte, bool) {
	if len(info) < 1 {
		return 0, false
	}
	// Prefer dedicated alarm byte near the end (before language uint16).
	if len(info) >= 3 {
		code := info[len(info)-3]
		if code != 0 {
			return code, true
		}
	}
	// Fallback: scan for known alarm codes in the tail half.
	start := len(info) / 2
	for i := start; i < len(info); i++ {
		switch info[i] {
		case 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x09, 0x0c, 0x0e, 0x13, 0x19, 0x23, 0x29:
			return info[i], true
		}
	}
	return 0, false
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
