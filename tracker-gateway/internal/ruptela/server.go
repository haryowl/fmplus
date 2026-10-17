package ruptela

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/deviceauth"
	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Serve Ruptela FM TCP per official protocol:
// records cmd 1 / extended 68 → server ACK cmd 100; SMS via GPRS cmd 108.
func Serve(ctx context.Context, addr string, st *store.Store, sessions *protocol.Registry) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	log.Printf("[ruptela] listening on %s (status=partial)", addr)
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
		gotCRC := binary.BigEndian.Uint16(payload[length : length+2])
		if calc := crc16Kermit(data); calc != gotCRC {
			metrics.DecodeErr()
			log.Printf("[ruptela] bad CRC got=%04x want=%04x — NACK cmd 100", gotCRC, calc)
			_ = writeRecordsAck(conn, false)
			continue
		}

		cmd, imei, rest := dissectPacket(data)
		switch cmd {
		case 1, 68: // classic + extended records
			if imei == "" {
				_ = writeRecordsAck(conn, false)
				continue
			}
			device := deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "ruptela")
			if device == nil {
				_ = writeRecordsAck(conn, false)
				continue
			}
			if sessions != nil && bound == nil {
				bound = &protocol.ConnSession{
					DeviceID: device.ID, IMEI: device.IMEI, Protocol: "ruptela", Conn: conn,
				}
				sessions.Bind(bound)
			}
			records := parseRecordPayload(rest, cmd == 68)
			for _, fix := range records {
				fix.SourceProtocol = "ruptela"
				if ev := safetyFromEventIO(fix); ev != nil {
					_ = st.InsertSafetyEvent(ctx, device, *ev)
				} else if ev := safetyFromIO(fix); ev != nil {
					_ = st.InsertSafetyEvent(ctx, device, *ev)
				}
				if err := deviceauth.Ingest(ctx, st, device, fix); err != nil {
					log.Printf("[ruptela] ingest %s: %v", imei, err)
				}
			}
			_ = writeRecordsAck(conn, true)
			flushPending(ctx, conn, st, device.ID)
		case 7: // SMS-via-GPRS response from device
			device := boundDevice(bound)
			if device == nil && imei != "" {
				device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "ruptela")
			}
			if device != nil {
				resp := strings.TrimSpace(string(rest))
				if resp == "" {
					resp = fmt.Sprintf("ruptela_cmd_7 %x", data)
				}
				ok := !ruptelaCmdFailed(resp)
				if matched, _ := st.AckSoftMatch(ctx, device.ID, ok, resp); !matched {
					_ = st.AckCommand(ctx, device.ID, "108", ok, resp)
				}
				_ = st.TouchSeen(ctx, device)
				flushPending(ctx, conn, st, device.ID)
			}
			_ = writeRecordsAck(conn, true)
		case 2, 3, 105, 107: // config / ident / command responses
			device := boundDevice(bound)
			if device == nil && imei != "" {
				device = deviceauth.FindByIMEI(ctx, st, imei, conn.RemoteAddr().String(), "ruptela")
			}
			if device != nil {
				resp := fmt.Sprintf("ruptela_cmd_%d %x", cmd, data)
				if len(rest) > 0 {
					resp = strings.TrimSpace(string(rest))
				}
				ok := !ruptelaCmdFailed(resp)
				corr := fmt.Sprintf("%d", cmd)
				if matched, _ := st.AckSoftMatch(ctx, device.ID, ok, resp); !matched {
					_ = st.AckCommand(ctx, device.ID, corr, ok, resp)
				}
				if cmd == 3 {
					_ = st.PatchLastStatus(ctx, device, parseIdentResponse(resp), nil)
				}
				_ = st.TouchSeen(ctx, device)
				flushPending(ctx, conn, st, device.ID)
			}
			_ = writeRecordsAck(conn, true)
		default:
			if device := boundDevice(bound); device != nil {
				_ = st.TouchSeen(ctx, device)
			}
			_ = writeRecordsAck(conn, true)
		}
	}
}

// dissectPacket handles official IMEI-first framing (records/SMS response)
// and cmd-first framing (rare / legacy).
func dissectPacket(data []byte) (cmd byte, imei string, rest []byte) {
	if len(data) >= 9 {
		maybe := data[8]
		switch maybe {
		case 1, 7, 2, 3, 68, 105, 107:
			imeiNum := binary.BigEndian.Uint64(data[0:8])
			return maybe, strconv.FormatUint(imeiNum, 10), data[9:]
		}
	}
	if len(data) >= 1 {
		return data[0], "", data[1:]
	}
	return 0, "", nil
}

func boundDevice(bound *protocol.ConnSession) *store.Device {
	if bound == nil {
		return nil
	}
	return &store.Device{ID: bound.DeviceID, IMEI: bound.IMEI, Protocol: bound.Protocol}
}

func flushPending(ctx context.Context, conn net.Conn, st *store.Store, deviceID string) {
	enc := Adapter{}
	for i := 0; i < 4; i++ {
		cmd, err := st.NextPendingCommand(ctx, deviceID)
		if err != nil || cmd == nil {
			return
		}
		payload, err := enc.EncodeDownlink(*cmd)
		if err != nil || len(payload) == 0 {
			_ = st.MarkCommandFailed(ctx, cmd.ID, "ruptela encode failed")
			continue
		}
		if _, err := conn.Write(payload); err != nil {
			_ = st.RequeueCommand(ctx, cmd.ID)
			return
		}
		_ = st.MarkCommandSentCorr(ctx, cmd.ID, DownlinkCorrID(cmd.CommandType))
	}
}

func ruptelaCmdFailed(resp string) bool {
	s := strings.TrimSpace(strings.ToUpper(resp))
	if s == "" {
		return false
	}
	for _, p := range []string{"ERROR", "FAIL", "NACK", "DENIED", "UNKNOWN"} {
		if strings.HasPrefix(s, p) || strings.Contains(s, " "+p) {
			return true
		}
	}
	return false
}

// writeRecordsAck sends official cmd 100 ACK: 00 02 64 01 [CRC] (or ACK=0 NACK).
func writeRecordsAck(conn net.Conn, ok bool) error {
	ack := byte(0)
	if ok {
		ack = 1
	}
	body := []byte{0x64, ack}
	crc := crc16Kermit(body)
	out := []byte{0x00, 0x02, 0x64, ack, byte(crc >> 8), byte(crc)}
	_, err := conn.Write(out)
	return err
}

// parseRecordPayload parses records after records_left + count (classic cmd 1 header = 23 bytes).
func parseRecordPayload(data []byte, extended bool) []store.Fix {
	if len(data) < 2 {
		return nil
	}
	recordsLeft := int(data[0])
	count := int(data[1])
	off := 2
	var fixes []store.Fix
	for i := 0; i < count && off+23 <= len(data); i++ {
		headerLen := 23
		if extended {
			headerLen = 25 // extended protocol: 2-byte event IO id
		}
		if off+headerLen > len(data) {
			break
		}
		ts := int64(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		off++ // timestamp extension
		off++ // priority
		lonRaw := int32(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		latRaw := int32(binary.BigEndian.Uint32(data[off : off+4]))
		off += 4
		alt := int16(binary.BigEndian.Uint16(data[off : off+2]))
		off += 2
		angle := binary.BigEndian.Uint16(data[off : off+2])
		off += 2
		sats := int(data[off])
		off++
		speed := binary.BigEndian.Uint16(data[off : off+2])
		off += 2
		hdop := data[off]
		off++
		var eventID any
		if extended {
			if off+2 > len(data) {
				break
			}
			eventID = int(binary.BigEndian.Uint16(data[off : off+2]))
			off += 2
		} else {
			eventID = int(data[off])
			off++
		}
		ioMap := map[string]any{}
		if extended {
			off = extractRuptelaIOExt(data, off, ioMap)
		} else {
			off = extractRuptelaIO(data, off, eventID, ioMap)
		}
		lon := float64(lonRaw) / 1e7
		lat := float64(latRaw) / 1e7
		spd := float64(speed)
		hdg := float64(angle) / 100.0
		altF := float64(alt) / 10.0
		raw := map[string]any{
			"io":            ioMap,
			"event_io":      eventID,
			"hdop":          int(hdop),
			"record_index":  i,
			"records_left":  recordsLeft,
			"extended":      extended,
		}
		for k, v := range ioMap {
			raw["io."+k] = v
		}
		promoteRuptelaScalars(raw, ioMap)
		flattenEventAlarm(raw)
		flattenIOAlarms(raw, ioMap)
		fix := store.Fix{
			Lat:            lat,
			Lon:            lon,
			RecordedAt:     time.Unix(ts, 0).UTC(),
			Speed:          &spd,
			Heading:        &hdg,
			Altitude:       &altF,
			Satellites:     &sats,
			SourceProtocol: "ruptela",
			RawAttrs:       raw,
		}
		if v, ok := ioMap["5"]; ok {
			b := asTruthy(v)
			fix.Ignition = &b
		} else if v, ok := ioMap["239"]; ok {
			b := asTruthy(v)
			fix.Ignition = &b
		}
		if v, ok := ioMap["65"]; ok {
			f := asFloat64(v)
			fix.Odometer = &f
		} else if v, ok := ioMap["199"]; ok {
			f := asFloat64(v) / 1000.0
			fix.Odometer = &f
		}
		fixes = append(fixes, fix)
	}
	return fixes
}

func extractRuptelaIO(b []byte, off int, event any, io map[string]any) int {
	_ = event
	if off >= len(b) {
		return off
	}
	n1 := int(b[off])
	off++
	for i := 0; i < n1 && off+2 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int(b[off])
		off++
	}
	if off >= len(b) {
		return off
	}
	n2 := int(b[off])
	off++
	for i := 0; i < n2 && off+3 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
	}
	if off >= len(b) {
		return off
	}
	n4 := int(b[off])
	off++
	for i := 0; i < n4 && off+5 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int64(binary.BigEndian.Uint32(b[off : off+4]))
		off += 4
	}
	if off >= len(b) {
		return off
	}
	n8 := int(b[off])
	off++
	for i := 0; i < n8 && off+9 <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = int64(binary.BigEndian.Uint64(b[off : off+8]))
		off += 8
	}
	return off
}

// extractRuptelaIOExt: extended protocol uses 2-byte IO IDs and 2-byte counts.
func extractRuptelaIOExt(b []byte, off int, io map[string]any) int {
	for _, size := range []int{1, 2, 4, 8} {
		if off+2 > len(b) {
			return off
		}
		n := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		for i := 0; i < n && off+2+size <= len(b); i++ {
			id := int(binary.BigEndian.Uint16(b[off : off+2]))
			off += 2
			switch size {
			case 1:
				io[fmt.Sprintf("%d", id)] = int(b[off])
			case 2:
				io[fmt.Sprintf("%d", id)] = int(binary.BigEndian.Uint16(b[off : off+2]))
			case 4:
				io[fmt.Sprintf("%d", id)] = int64(binary.BigEndian.Uint32(b[off : off+4]))
			case 8:
				io[fmt.Sprintf("%d", id)] = int64(binary.BigEndian.Uint64(b[off : off+8]))
			}
			off += size
		}
	}
	return off
}

// promoteRuptelaScalars lifts common FM IO ids onto remappable keys (partial; overlaps Teltonika AVL).
func promoteRuptelaScalars(raw map[string]any, io map[string]any) {
	if raw == nil || io == nil {
		return
	}
	if v, ok := io["66"]; ok {
		raw["voltage.ext"] = asFloat64(v) / 1000.0
	}
	if v, ok := io["67"]; ok {
		raw["voltage.batt"] = asFloat64(v) / 1000.0
	}
	if v, ok := io["89"]; ok {
		raw["fuel.level"] = asFloat64(v)
	}
	if v, ok := io["72"]; ok {
		raw["temp.1"] = asFloat64(v)
	}
	if v, ok := io["73"]; ok {
		raw["temp.2"] = asFloat64(v)
	}
	if v, ok := io["74"]; ok {
		raw["temp.3"] = asFloat64(v)
	}
	if v, ok := io["21"]; ok {
		raw["gsm.signal"] = asFloat64(v)
	}
	if v, ok := io["24"]; ok {
		raw["speed.io"] = asFloat64(v)
	}
	if v, ok := io["251"]; ok {
		raw["idling"] = asTruthy(v)
	}
	if v, ok := io["199"]; ok {
		raw["trip.odometer"] = asFloat64(v)
	}
	if v, ok := io["25"]; ok {
		raw["ble.temp1"] = asFloat64(v) / 10.0
	}
	if v, ok := io["26"]; ok {
		raw["ble.temp2"] = asFloat64(v) / 10.0
	}
	if v, ok := io["29"]; ok {
		raw["ble.humidity"] = asFloat64(v)
	}
	if v, ok := io["253"]; ok {
		raw["green_driving.value"] = asFloat64(v)
	}
	if v, ok := io["243"]; ok {
		raw["green_driving.duration"] = asFloat64(v)
	}
	if v, ok := io["17"]; ok {
		raw["accel.x"] = asFloat64(v)
	}
	if v, ok := io["18"]; ok {
		raw["accel.y"] = asFloat64(v)
	}
	if v, ok := io["19"]; ok {
		raw["accel.z"] = asFloat64(v)
	}
}

func asTruthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int:
		return t != 0
	case int64:
		return t != 0
	case float64:
		return t != 0
	default:
		return false
	}
}

func asFloat64(v any) float64 {
	switch t := v.(type) {
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float64:
		return t
	default:
		return 0
	}
}
