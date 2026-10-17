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
		protoMsg := "ruptela_cmd_1"
		if extended {
			protoMsg = "ruptela_cmd_68"
		}
		raw := map[string]any{
			"io":            ioMap,
			"event_io":      eventID,
			"hdop":          int(hdop),
			"record_index":  i,
			"records_left":  recordsLeft,
			"extended":      extended,
			"proto_msg":     protoMsg,
		}
		if hdop > 0 {
			raw["gnss.hdop"] = float64(hdop) / 10.0
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
		} else if v, ok := ioMap["16"]; ok {
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
	if v, ok := io["759"]; ok {
		raw["fuel.type"] = asFloat64(v)
	}
	if v, ok := io["84"]; ok {
		raw["fuel.volume"] = asFloat64(v)
	}
	if v, ok := io["36"]; ok {
		raw["engine.rpm"] = asFloat64(v)
	}
	if v, ok := io["37"]; ok {
		raw["speed.obd"] = asFloat64(v)
	}
	if v, ok := io["38"]; ok {
		raw["engine.timing_advance"] = asFloat64(v)
	}
	if v, ok := io["43"]; ok {
		raw["obd.mil_distance"] = asFloat64(v)
	}
	if v, ok := io["44"]; ok {
		raw["fuel.rail_relative"] = asFloat64(v) / 10.0 // kPa ×0.1
	}
	if v, ok := io["45"]; ok {
		raw["fuel.rail_direct"] = asFloat64(v) * 10.0 // kPa ×10
	}
	if v, ok := io["46"]; ok {
		raw["engine.egr_commanded"] = asFloat64(v)
	}
	if v, ok := io["47"]; ok {
		raw["engine.egr_error"] = asFloat64(v)
	}
	if v, ok := io["54"]; ok {
		raw["obd.mil_time"] = asFloat64(v) // minutes
	}
	if v, ok := io["55"]; ok {
		raw["obd.codes_cleared_time"] = asFloat64(v) // minutes
	}
	if v, ok := io["56"]; ok {
		raw["fuel.rail_absolute"] = asFloat64(v) * 10.0 // kPa ×10
	}
	if v, ok := io["49"]; ok {
		raw["obd.codes_cleared_distance"] = asFloat64(v) // km
	}
	if v, ok := io["57"]; ok {
		raw["hybrid.battery_life"] = asFloat64(v) // %
	}
	if v, ok := io["59"]; ok {
		raw["engine.injection_timing"] = asFloat64(v) / 100.0 // ° ×0.01
	}
	if v, ok := io["60"]; ok {
		raw["engine.fuel_rate"] = asFloat64(v) / 100.0 // L/h ×0.01 (distinct from IO13 fuel.rate)
	}
	if v, ok := io["68"]; ok {
		raw["battery.current"] = asFloat64(v) / 1000.0 // A ×0.001
	}
	if v, ok := io["80"]; ok {
		raw["network.data_mode"] = asFloat64(v)
	}
	if v, ok := io["541"]; ok {
		raw["fuel.air_equivalence"] = asFloat64(v) / 100.0 // ×0.01
	}
	if v, ok := io["543"]; ok {
		raw["hybrid.system_voltage"] = asFloat64(v)
	}
	if v, ok := io["544"]; ok {
		raw["hybrid.system_current"] = float64(int16(uint16(asFloat64(v)))) // signed A
	}
	if v, ok := io["34"]; ok {
		raw["fuel.pressure"] = asFloat64(v)
	}
	if v, ok := io["35"]; ok {
		raw["engine.map"] = asFloat64(v)
	}
	if v, ok := io["39"]; ok {
		raw["engine.intake_temp"] = asFloat64(v)
	}
	if v, ok := io["40"]; ok {
		raw["engine.maf"] = asFloat64(v) / 100.0 // g/s ×0.01
	}
	if v, ok := io["50"]; ok {
		raw["engine.baro"] = asFloat64(v)
	}
	if v, ok := io["51"]; ok {
		raw["obd.ecu_voltage"] = asFloat64(v) / 1000.0 // mV → V
	}
	if v, ok := io["53"]; ok {
		raw["engine.ambient_temp"] = asFloat64(v)
	}
	if v, ok := io["58"]; ok {
		raw["engine.oil_temp"] = asFloat64(v)
	}
	if v, ok := io["32"]; ok {
		raw["engine.coolant_temp"] = asFloat64(v)
	}
	if v, ok := io["33"]; ok {
		raw["engine.short_fuel_trim"] = asFloat64(v)
	}
	if v, ok := io["30"]; ok {
		raw["obd.dtc_count"] = asFloat64(v)
	}
	if v, ok := io["31"]; ok {
		raw["engine.load"] = asFloat64(v)
	}
	if v, ok := io["41"]; ok {
		raw["engine.throttle"] = asFloat64(v)
	}
	if v, ok := io["42"]; ok {
		raw["engine.runtime"] = asFloat64(v)
	}
	if v, ok := io["12"]; ok {
		raw["fuel.used"] = asFloat64(v)
	}
	if v, ok := io["13"]; ok {
		raw["fuel.rate"] = asFloat64(v)
	}
	if v, ok := io["48"]; ok {
		raw["fuel.used_total"] = asFloat64(v)
		if _, has := raw["fuel.used"]; !has {
			raw["fuel.used"] = asFloat64(v)
		}
	}
	if v, ok := io["239"]; ok {
		raw["status.ignition"] = asTruthy(v)
	} else if v, ok := io["5"]; ok {
		raw["status.ignition"] = asTruthy(v)
	}
	for i, id := range []string{"1", "2", "3", "4", "5", "6", "7", "8"} {
		if v, ok := io[id]; ok {
			raw[fmt.Sprintf("status.din%d", i+1)] = asTruthy(v)
		}
	}
	if v, ok := io["179"]; ok {
		raw["status.dout1"] = asTruthy(v)
	}
	if v, ok := io["180"]; ok {
		raw["status.dout2"] = asTruthy(v)
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
	if v, ok := io["75"]; ok {
		raw["temp.4"] = asFloat64(v)
	}
	if v, ok := io["21"]; ok {
		raw["gsm.signal"] = asFloat64(v)
	}
	if v, ok := io["241"]; ok {
		raw["gsm.operator"] = asFloat64(v)
	}
	if v, ok := io["205"]; ok {
		raw["gsm.cell_id"] = asFloat64(v)
	}
	if v, ok := io["206"]; ok {
		raw["gsm.lac"] = asFloat64(v)
	}
	if v, ok := io["237"]; ok {
		raw["network.type"] = asFloat64(v)
	}
	if v, ok := io["11"]; ok {
		raw["gsm.iccid"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["78"]; ok {
		raw["ibutton.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["207"]; ok {
		raw["rfid.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["238"]; ok {
		raw["user.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["256"]; ok {
		raw["vehicle.vin"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["281"]; ok {
		raw["obd.fault_codes"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["263"]; ok {
		raw["bt.status"] = asFloat64(v)
	}
	if v, ok := io["264"]; ok {
		raw["barcode.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["269"]; ok {
		raw["ble.fuel_temp1"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["270"]; ok {
		raw["ble.fuel1"] = asFloat64(v)
	}
	if v, ok := io["271"]; ok {
		raw["ble.fuel_batt1"] = asFloat64(v) / 100.0
	}
	if v, ok := io["272"]; ok {
		raw["ble.fuel_temp2"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["273"]; ok {
		raw["ble.fuel2"] = asFloat64(v)
	}
	if v, ok := io["274"]; ok {
		raw["ble.fuel_batt2"] = asFloat64(v) / 100.0
	}
	if v, ok := io["275"]; ok {
		raw["ble.fuel_temp3"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["276"]; ok {
		raw["ble.fuel3"] = asFloat64(v)
	}
	if v, ok := io["277"]; ok {
		raw["ble.fuel_batt3"] = asFloat64(v) / 100.0
	}
	if v, ok := io["278"]; ok {
		raw["ble.fuel_temp4"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["279"]; ok {
		raw["ble.fuel4"] = asFloat64(v)
	}
	if v, ok := io["280"]; ok {
		raw["ble.fuel_batt4"] = asFloat64(v) / 100.0
	}
	if v, ok := io["306"]; ok {
		raw["ble.fuel_freq1"] = asFloat64(v)
	}
	if v, ok := io["307"]; ok {
		raw["ble.fuel_freq2"] = asFloat64(v)
	}
	if v, ok := io["308"]; ok {
		raw["ble.fuel_freq3"] = asFloat64(v)
	}
	if v, ok := io["309"]; ok {
		raw["ble.fuel_freq4"] = asFloat64(v)
	}
	if v, ok := io["331"]; ok {
		raw["ble.custom1_1"] = asFloat64(v)
	}
	if v, ok := io["332"]; ok {
		raw["ble.custom1_2"] = asFloat64(v)
	}
	if v, ok := io["333"]; ok {
		raw["ble.custom1_3"] = asFloat64(v)
	}
	if v, ok := io["334"]; ok {
		raw["ble.custom1_4"] = asFloat64(v)
	}
	if v, ok := io["335"]; ok {
		raw["ble.luminosity1"] = asFloat64(v)
	}
	if v, ok := io["336"]; ok {
		raw["ble.luminosity2"] = asFloat64(v)
	}
	if v, ok := io["337"]; ok {
		raw["ble.luminosity3"] = asFloat64(v)
	}
	if v, ok := io["338"]; ok {
		raw["ble.luminosity4"] = asFloat64(v)
	}
	if v, ok := io["463"]; ok {
		raw["ble.custom2_1"] = asFloat64(v)
	}
	if v, ok := io["464"]; ok {
		raw["ble.custom2_2"] = asFloat64(v)
	}
	if v, ok := io["465"]; ok {
		raw["ble.custom2_3"] = asFloat64(v)
	}
	if v, ok := io["466"]; ok {
		raw["ble.custom2_4"] = asFloat64(v)
	}
	if v, ok := io["467"]; ok {
		raw["ble.custom3_1"] = asFloat64(v)
	}
	if v, ok := io["468"]; ok {
		raw["ble.custom3_2"] = asFloat64(v)
	}
	if v, ok := io["469"]; ok {
		raw["ble.custom3_3"] = asFloat64(v)
	}
	if v, ok := io["470"]; ok {
		raw["ble.custom3_4"] = asFloat64(v)
	}
	if v, ok := io["471"]; ok {
		raw["ble.custom4_1"] = asFloat64(v)
	}
	if v, ok := io["472"]; ok {
		raw["ble.custom4_2"] = asFloat64(v)
	}
	if v, ok := io["473"]; ok {
		raw["ble.custom4_3"] = asFloat64(v)
	}
	if v, ok := io["474"]; ok {
		raw["ble.custom4_4"] = asFloat64(v)
	}
	if v, ok := io["475"]; ok {
		raw["ble.custom5_1"] = asFloat64(v)
	}
	if v, ok := io["476"]; ok {
		raw["ble.custom5_2"] = asFloat64(v)
	}
	if v, ok := io["477"]; ok {
		raw["ble.custom5_3"] = asFloat64(v)
	}
	if v, ok := io["478"]; ok {
		raw["ble.custom5_4"] = asFloat64(v)
	}
	if v, ok := io["390"]; ok {
		raw["fuel.oem_level"] = asFloat64(v) / 10.0
	}
	if v, ok := io["201"]; ok {
		raw["fuel.lls1"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["202"]; ok {
		raw["fuel.lls_temp1"] = float64(int8(uint8(asFloat64(v))))
	}
	if v, ok := io["203"]; ok {
		raw["fuel.lls2"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["204"]; ok {
		raw["fuel.lls_temp2"] = float64(int8(uint8(asFloat64(v))))
	}
	if v, ok := io["210"]; ok {
		raw["fuel.lls3"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["211"]; ok {
		raw["fuel.lls_temp3"] = float64(int8(uint8(asFloat64(v))))
	}
	if v, ok := io["212"]; ok {
		raw["fuel.lls4"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["213"]; ok {
		raw["fuel.lls_temp4"] = float64(int8(uint8(asFloat64(v))))
	}
	if v, ok := io["214"]; ok {
		raw["fuel.lls5"] = float64(int16(uint16(asFloat64(v))))
	}
	if v, ok := io["215"]; ok {
		raw["fuel.lls_temp5"] = float64(int8(uint8(asFloat64(v))))
	}
	if v, ok := io["381"]; ok {
		raw["ground.sense"] = asTruthy(v)
	}
	if v, ok := io["385"]; ok {
		raw["beacon.ids"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["387"]; ok {
		raw["gnss.iso6709"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["250"]; ok {
		raw["trip.distance"] = asFloat64(v)
	}
	if v, ok := io["255"]; ok {
		raw["overspeed.threshold"] = asFloat64(v)
	}
	if v, ok := io["181"]; ok {
		raw["gnss.pdop"] = asFloat64(v) / 10.0
	}
	if v, ok := io["182"]; ok {
		raw["gnss.hdop"] = asFloat64(v) / 10.0
	}
	if v, ok := io["69"]; ok {
		raw["gnss.status"] = asFloat64(v)
	}
	if v, ok := io["70"]; ok {
		raw["pcb.temp"] = asFloat64(v) / 10.0 // °C ×10 (PRO/FT parity)
	}
	if v, ok := io["246"]; ok {
		raw["status.towing"] = asTruthy(v)
	}
	if v, ok := io["247"]; ok {
		raw["status.crash"] = asTruthy(v)
	}
	if v, ok := io["248"]; ok {
		raw["status.geofence"] = asTruthy(v)
	}
	if v, ok := io["249"]; ok {
		raw["status.jamming"] = asTruthy(v)
	}
	if v, ok := io["252"]; ok {
		raw["status.unplug"] = asTruthy(v)
	}
	if v, ok := io["240"]; ok {
		raw["status.movement"] = asTruthy(v)
	}
	if v, ok := io["24"]; ok {
		raw["speed.io"] = asFloat64(v)
	}
	if v, ok := io["251"]; ok {
		raw["idling"] = asTruthy(v)
		raw["status.idling"] = asTruthy(v)
	}
	if v, ok := io["199"]; ok {
		raw["trip.odometer"] = asFloat64(v)
	}
	if v, ok := io["65"]; ok {
		raw["odometer"] = asFloat64(v)
	} else if v, ok := io["16"]; ok {
		raw["odometer"] = asFloat64(v)
	} else if v, ok := io["199"]; ok {
		raw["odometer"] = asFloat64(v) / 1000.0
	}
	if v, ok := io["25"]; ok {
		raw["ble.temp1"] = asFloat64(v) / 10.0
	}
	if v, ok := io["26"]; ok {
		raw["ble.temp2"] = asFloat64(v) / 10.0
	}
	if v, ok := io["27"]; ok {
		raw["ble.temp3"] = asFloat64(v) / 10.0
	}
	if v, ok := io["28"]; ok {
		raw["ble.temp4"] = asFloat64(v) / 10.0
	}
	if v, ok := io["29"]; ok {
		raw["ble.humidity"] = asFloat64(v)
	}
	if v, ok := io["104"]; ok {
		raw["ble.humidity2"] = asFloat64(v)
	}
	if v, ok := io["106"]; ok {
		raw["ble.humidity3"] = asFloat64(v)
	}
	if v, ok := io["108"]; ok {
		raw["ble.humidity4"] = asFloat64(v)
	}
	if v, ok := io["86"]; ok {
		raw["ble.battery"] = asFloat64(v)
	}
	if v, ok := io["20"]; ok {
		raw["ble.battery2"] = asFloat64(v)
	}
	if v, ok := io["22"]; ok {
		raw["ble.battery3"] = asFloat64(v)
	}
	if v, ok := io["23"]; ok {
		raw["ble.battery4"] = asFloat64(v)
	}
	if v, ok := io["113"]; ok {
		raw["battery.level"] = asFloat64(v)
	}
	if v, ok := io["114"]; ok {
		raw["battery.voltage"] = asFloat64(v) / 1000.0
	}
	if v, ok := io["9"]; ok {
		raw["voltage.ain1"] = asFloat64(v) / 1000.0
	}
	if v, ok := io["10"]; ok {
		raw["voltage.ain2"] = asFloat64(v) / 1000.0
	}
	if v, ok := io["15"]; ok {
		raw["eco.score"] = asFloat64(v)
	}
	if v, ok := io["200"]; ok {
		raw["sleep.mode"] = asFloat64(v)
		raw["status.sleeping"] = asFloat64(v) != 0
	}
	if v, ok := io["253"]; ok {
		raw["green_driving.value"] = asFloat64(v)
	}
	if v, ok := io["243"]; ok {
		raw["green_driving.duration"] = asFloat64(v)
	}
	if v, ok := io["254"]; ok {
		raw["green_driving.magnitude"] = asFloat64(v) / 100.0
	}
	if v, ok := io["236"]; ok {
		raw["alarm.event"] = asTruthy(v)
	}
	if v, ok := io["257"]; ok {
		raw["crash.trace"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["391"]; ok {
		raw["status.private_mode"] = asTruthy(v)
	}
	if v, ok := io["14"]; ok {
		raw["gsm.iccid2"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["81"]; ok {
		raw["can.vehicle_speed"] = asFloat64(v)
	}
	if v, ok := io["82"]; ok {
		raw["can.throttle"] = asFloat64(v)
	}
	if v, ok := io["83"]; ok {
		raw["can.fuel_consumed"] = asFloat64(v) / 10.0
	}
	if v, ok := io["85"]; ok {
		raw["can.engine_rpm"] = asFloat64(v)
	}
	if v, ok := io["87"]; ok {
		raw["can.mileage"] = asFloat64(v)
	}
	if v, ok := io["105"]; ok {
		raw["can.mileage_counted"] = asFloat64(v)
	}
	if v, ok := io["107"]; ok {
		raw["can.fuel_counted"] = asFloat64(v) / 10.0
	}
	if v, ok := io["115"]; ok {
		raw["can.coolant_temp"] = asFloat64(v) / 10.0
	}
	if v, ok := io["168"]; ok {
		raw["can.battery_voltage"] = asFloat64(v)
	}
	if v, ok := io["118"]; ok {
		raw["axle.load1"] = asFloat64(v)
	}
	if v, ok := io["119"]; ok {
		raw["axle.load2"] = asFloat64(v)
	}
	if v, ok := io["120"]; ok {
		raw["axle.load3"] = asFloat64(v)
	}
	if v, ok := io["121"]; ok {
		raw["axle.load4"] = asFloat64(v)
	}
	if v, ok := io["122"]; ok {
		raw["axle.load5"] = asFloat64(v)
	}
	if v, ok := io["76"]; ok {
		raw["temp.id1"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["77"]; ok {
		raw["temp.id2"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["79"]; ok {
		raw["temp.id3"] = fmt.Sprintf("%v", v)
	}
	for id, key := range ruptelaGeofenceIO {
		if v, ok := io[id]; ok {
			raw[key] = asFloat64(v)
		}
	}
	if v, ok := io["175"]; ok {
		raw["geofence.auto"] = asFloat64(v)
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

// ruptelaGeofenceIO maps FM IO → geofence.zoneN (Teltonika FMB parity).
// Skips IO 65 (Ruptela odometer) and IO 70 (pcb.temp).
var ruptelaGeofenceIO = map[string]string{
	"155": "geofence.zone1", "156": "geofence.zone2", "157": "geofence.zone3",
	"158": "geofence.zone4", "159": "geofence.zone5",
	"61": "geofence.zone6", "62": "geofence.zone7", "63": "geofence.zone8", "64": "geofence.zone9",
	"88": "geofence.zone12", "91": "geofence.zone13", "92": "geofence.zone14", "93": "geofence.zone15",
	"94": "geofence.zone16", "95": "geofence.zone17", "96": "geofence.zone18", "97": "geofence.zone19",
	"98": "geofence.zone20", "99": "geofence.zone21", "153": "geofence.zone22", "154": "geofence.zone23",
	"190": "geofence.zone24", "191": "geofence.zone25", "192": "geofence.zone26", "193": "geofence.zone27",
	"194": "geofence.zone28", "195": "geofence.zone29", "196": "geofence.zone30", "197": "geofence.zone31",
	"198": "geofence.zone32", "208": "geofence.zone33", "209": "geofence.zone34", "216": "geofence.zone35",
	"217": "geofence.zone36", "218": "geofence.zone37", "219": "geofence.zone38", "220": "geofence.zone39",
	"221": "geofence.zone40", "222": "geofence.zone41", "223": "geofence.zone42", "224": "geofence.zone43",
	"225": "geofence.zone44", "226": "geofence.zone45", "227": "geofence.zone46", "228": "geofence.zone47",
	"229": "geofence.zone48", "230": "geofence.zone49", "231": "geofence.zone50",
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
