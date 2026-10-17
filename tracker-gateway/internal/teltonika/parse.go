package teltonika

import (
	"encoding/binary"
	"fmt"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// CRC16 IBM / ARC used by Teltonika AVL (poly 0xA001).
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

func verifyAVLCRC(payload, crcBuf []byte) bool {
	if len(crcBuf) < 4 {
		return false
	}
	got := binary.BigEndian.Uint32(crcBuf)
	want := uint32(crc16IBM(payload))
	return got == want
}

func parseAVL(payload []byte) (int, []store.Fix) {
	if len(payload) < 2 {
		return 0, nil
	}
	codec := payload[0]
	var n, off int
	if codec == 0x8e {
		// Codec 8 Extended: number of records is uint16 BE
		if len(payload) < 3 {
			return 0, nil
		}
		n = int(binary.BigEndian.Uint16(payload[1:3]))
		off = 3
	} else {
		n = int(payload[1])
		off = 2
	}
	if n == 0 {
		return 0, nil
	}
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
		io := map[string]any{}
		var eventID any

		var ioOK bool
		switch codec {
		case 0x08:
			off, eventID, io = extractIO8(payload, off)
			ioOK = true
		case 0x8e:
			off, eventID, io = extractIO8E(payload, off)
			ioOK = true
		case 0x10:
			// Codec 16: 1-byte record count (like 8) + 2-byte AVL IDs.
			off, eventID, io = extractIO16(payload, off)
			ioOK = true
		}
		if !ioOK {
			// Unknown AVL codec: keep GPS fix, stop record loop (IO length unknown).
			fixes = append(fixes, store.Fix{
				Lat: lat, Lon: lon, RecordedAt: time.UnixMilli(tsMs).UTC(),
				Speed: &spd, Heading: &hdg, Altitude: &altF, Satellites: &sats,
				RawAttrs: map[string]any{"codec": codec, "io": io, "codec_unsupported": true},
			})
			break
		}

		raw := map[string]any{
			"codec":    codec,
			"io":       io,
			"event_io": eventID,
		}
		// Promote common AVL ids into typed hints when present
		fix := store.Fix{
			Lat: lat, Lon: lon, RecordedAt: time.UnixMilli(tsMs).UTC(),
			Speed: &spd, Heading: &hdg, Altitude: &altF, Satellites: &sats,
			RawAttrs: raw,
		}
		if v, ok := io["239"]; ok {
			b := asIOBool(v)
			fix.Ignition = &b
		} else if v, ok := io["1"]; ok {
			// Some configs use DIN1 as ignition
			b := asIOBool(v)
			fix.Ignition = &b
		}
		if v, ok := io["16"]; ok {
			f := asIOFloat(v)
			fix.Odometer = &f
		} else if v, ok := io["389"]; ok {
			f := asIOFloat(v) / 1000.0
			fix.Odometer = &f
		}
		// Flatten io.* for Device Manager remap vendor keys.
		for k, v := range io {
			raw["io."+k] = v
		}
		promoteTeltonikaScalars(raw, io)
		flattenEventAlarm(raw)
		flattenIOAlarms(raw, io)
		fixes = append(fixes, fix)
	}
	return n, fixes
}

// promoteTeltonikaScalars lifts common FMB AVL IDs onto remappable raw keys (partial set).
func promoteTeltonikaScalars(raw map[string]any, io map[string]any) {
	if raw == nil || io == nil {
		return
	}
	if v, ok := io["66"]; ok {
		raw["voltage.ext"] = asIOFloat(v) / 1000.0 // mV → V
	}
	if v, ok := io["67"]; ok {
		raw["voltage.batt"] = asIOFloat(v) / 1000.0
	}
	if v, ok := io["9"]; ok {
		raw["voltage.ain1"] = asIOFloat(v) / 1000.0
	}
	if v, ok := io["10"]; ok {
		raw["voltage.ain2"] = asIOFloat(v) / 1000.0
	}
	if v, ok := io["21"]; ok {
		raw["gsm.signal"] = asIOFloat(v)
	}
	if v, ok := io["241"]; ok {
		raw["gsm.operator"] = asIOFloat(v)
	}
	if v, ok := io["11"]; ok {
		raw["gsm.iccid"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["78"]; ok {
		raw["ibutton.id"] = fmt.Sprintf("%v", v)
	}
	if v, ok := io["250"]; ok {
		raw["trip.distance"] = asIOFloat(v)
	}
	if v, ok := io["255"]; ok {
		raw["overspeed.threshold"] = asIOFloat(v)
	}
	if v, ok := io["24"]; ok {
		raw["speed.io"] = asIOFloat(v)
	}
	if v, ok := io["199"]; ok {
		raw["trip.odometer"] = asIOFloat(v)
	}
	if v, ok := io["16"]; ok {
		raw["odometer"] = asIOFloat(v)
	} else if v, ok := io["389"]; ok {
		raw["odometer"] = asIOFloat(v) / 1000.0
	}
	if v, ok := io["89"]; ok {
		raw["fuel.level"] = asIOFloat(v)
	}
	if v, ok := io["84"]; ok {
		raw["fuel.volume"] = asIOFloat(v)
	}
	if v, ok := io["36"]; ok {
		raw["engine.rpm"] = asIOFloat(v)
	}
	if v, ok := io["37"]; ok {
		raw["speed.obd"] = asIOFloat(v)
	}
	if v, ok := io["38"]; ok {
		raw["engine.timing_advance"] = asIOFloat(v)
	}
	if v, ok := io["43"]; ok {
		raw["obd.mil_distance"] = asIOFloat(v)
	}
	if v, ok := io["44"]; ok {
		raw["fuel.rail_relative"] = asIOFloat(v) / 10.0 // kPa ×0.1
	}
	if v, ok := io["45"]; ok {
		raw["fuel.rail_direct"] = asIOFloat(v) * 10.0 // kPa ×10
	}
	if v, ok := io["46"]; ok {
		raw["engine.egr_commanded"] = asIOFloat(v)
	}
	if v, ok := io["47"]; ok {
		raw["engine.egr_error"] = asIOFloat(v)
	}
	if v, ok := io["54"]; ok {
		raw["obd.mil_time"] = asIOFloat(v) // minutes
	}
	if v, ok := io["55"]; ok {
		raw["obd.codes_cleared_time"] = asIOFloat(v) // minutes
	}
	if v, ok := io["56"]; ok {
		raw["fuel.rail_absolute"] = asIOFloat(v) * 10.0 // kPa ×10
	}
	if v, ok := io["49"]; ok {
		raw["obd.codes_cleared_distance"] = asIOFloat(v) // km
	}
	if v, ok := io["57"]; ok {
		raw["hybrid.battery_life"] = asIOFloat(v) // %
	}
	if v, ok := io["59"]; ok {
		raw["engine.injection_timing"] = asIOFloat(v) / 100.0 // ° ×0.01
	}
	if v, ok := io["34"]; ok {
		raw["fuel.pressure"] = asIOFloat(v)
	}
	if v, ok := io["35"]; ok {
		raw["engine.map"] = asIOFloat(v)
	}
	if v, ok := io["39"]; ok {
		raw["engine.intake_temp"] = asIOFloat(v)
	}
	if v, ok := io["40"]; ok {
		raw["engine.maf"] = asIOFloat(v) / 100.0 // g/s ×0.01
	}
	if v, ok := io["50"]; ok {
		raw["engine.baro"] = asIOFloat(v)
	}
	if v, ok := io["51"]; ok {
		raw["obd.ecu_voltage"] = asIOFloat(v) / 1000.0 // mV → V
	}
	if v, ok := io["53"]; ok {
		raw["engine.ambient_temp"] = asIOFloat(v)
	}
	if v, ok := io["58"]; ok {
		raw["engine.oil_temp"] = asIOFloat(v)
	}
	if v, ok := io["32"]; ok {
		raw["engine.coolant_temp"] = asIOFloat(v)
	}
	if v, ok := io["33"]; ok {
		raw["engine.short_fuel_trim"] = asIOFloat(v)
	}
	if v, ok := io["30"]; ok {
		raw["obd.dtc_count"] = asIOFloat(v)
	}
	if v, ok := io["31"]; ok {
		raw["engine.load"] = asIOFloat(v)
	}
	if v, ok := io["41"]; ok {
		raw["engine.throttle"] = asIOFloat(v)
	}
	if v, ok := io["42"]; ok {
		raw["engine.runtime"] = asIOFloat(v)
	}
	if v, ok := io["12"]; ok {
		raw["fuel.used"] = asIOFloat(v)
	}
	if v, ok := io["13"]; ok {
		raw["fuel.rate"] = asIOFloat(v)
	}
	if v, ok := io["48"]; ok {
		raw["fuel.used_total"] = asIOFloat(v)
		if _, has := raw["fuel.used"]; !has {
			raw["fuel.used"] = asIOFloat(v)
		}
	}
	if v, ok := io["239"]; ok {
		raw["status.ignition"] = asIOBool(v)
	} else if v, ok := io["1"]; ok {
		raw["status.ignition"] = asIOBool(v)
	}
	for i, id := range []string{"1", "2", "3", "4", "5", "6", "7", "8"} {
		if v, ok := io[id]; ok {
			raw[fmt.Sprintf("status.din%d", i+1)] = asIOBool(v)
		}
	}
	if v, ok := io["179"]; ok {
		raw["status.dout1"] = asIOBool(v)
	}
	if v, ok := io["180"]; ok {
		raw["status.dout2"] = asIOBool(v)
	}
	if v, ok := io["200"]; ok {
		raw["sleep.mode"] = asIOFloat(v)
		raw["status.sleeping"] = asIOFloat(v) != 0
	}
	if v, ok := io["251"]; ok {
		raw["idling"] = asIOBool(v)
		raw["status.idling"] = asIOBool(v)
	}
	// Common FMB BLE/temp sensors (wiki AVL IDs — model configs vary).
	if v, ok := io["72"]; ok {
		raw["temp.1"] = asIOFloat(v)
	}
	if v, ok := io["73"]; ok {
		raw["temp.2"] = asIOFloat(v)
	}
	if v, ok := io["74"]; ok {
		raw["temp.3"] = asIOFloat(v)
	}
	if v, ok := io["75"]; ok {
		raw["temp.4"] = asIOFloat(v)
	}
	if v, ok := io["25"]; ok {
		raw["ble.temp1"] = asIOFloat(v) / 10.0 // °C ×10
	}
	if v, ok := io["26"]; ok {
		raw["ble.temp2"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["27"]; ok {
		raw["ble.temp3"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["28"]; ok {
		raw["ble.temp4"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["29"]; ok {
		raw["ble.humidity"] = asIOFloat(v)
	}
	if v, ok := io["86"]; ok {
		raw["ble.battery"] = asIOFloat(v)
	}
	if v, ok := io["113"]; ok {
		raw["battery.level"] = asIOFloat(v)
	}
	if v, ok := io["114"]; ok {
		raw["battery.voltage"] = asIOFloat(v) / 1000.0 // mV → V when millivolt
	}
	// Green driving / eco metrics (AVL IDs — config dependent).
	if v, ok := io["253"]; ok {
		raw["green_driving.value"] = asIOFloat(v)
	}
	if v, ok := io["243"]; ok {
		raw["green_driving.duration"] = asIOFloat(v)
	}
	if v, ok := io["15"]; ok {
		raw["eco.score"] = asIOFloat(v)
	}
	// Axis acceleration (common FMB AVL 17/18/19 — milli-g or device units).
	if v, ok := io["17"]; ok {
		raw["accel.x"] = asIOFloat(v)
	}
	if v, ok := io["18"]; ok {
		raw["accel.y"] = asIOFloat(v)
	}
	if v, ok := io["19"]; ok {
		raw["accel.z"] = asIOFloat(v)
	}
	if v, ok := io["181"]; ok {
		raw["gnss.pdop"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["182"]; ok {
		raw["gnss.hdop"] = asIOFloat(v) / 10.0
	}
	if v, ok := io["69"]; ok {
		raw["gnss.status"] = asIOFloat(v)
	}
	if v, ok := io["70"]; ok {
		raw["pcb.temp"] = asIOFloat(v) / 10.0 // °C ×10 (PRO/FT/FMX)
	}
	if v, ok := io["246"]; ok {
		raw["status.towing"] = asIOBool(v)
	}
	if v, ok := io["247"]; ok {
		raw["status.crash"] = asIOBool(v)
	}
	if v, ok := io["248"]; ok {
		raw["status.geofence"] = asIOBool(v)
	}
	if v, ok := io["249"]; ok {
		raw["status.jamming"] = asIOBool(v)
	}
	if v, ok := io["252"]; ok {
		raw["status.unplug"] = asIOBool(v)
	}
	if v, ok := io["240"]; ok {
		raw["status.movement"] = asIOBool(v)
	}
}

func extractIO8(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off >= len(b) {
		return off, event, io
	}
	event = int(b[off])
	off++
	if off >= len(b) {
		return off, event, io
	}
	off++ // total IO count (informational)
	off = readSizedIO8(b, off, 1, io)
	off = readSizedIO8(b, off, 2, io)
	off = readSizedIO8(b, off, 4, io)
	off = readSizedIO8(b, off, 8, io)
	return off, event, io
}

func readSizedIO8(b []byte, off, size int, io map[string]any) int {
	if off >= len(b) {
		return off
	}
	n := int(b[off])
	off++
	for i := 0; i < n && off+1+size <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

// extractIO16: Event IO ID u16, N total u8, then sized groups with AVL ID u16 + value.
// Per Teltonika Codec wiki (Codec 16).
func extractIO16(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off+2 > len(b) {
		return off, event, io
	}
	event = int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	if off >= len(b) {
		return off, event, io
	}
	off++ // total IO count (1 byte)
	off = readSizedIO16(b, off, 1, io)
	off = readSizedIO16(b, off, 2, io)
	off = readSizedIO16(b, off, 4, io)
	off = readSizedIO16(b, off, 8, io)
	// NX variable-length IO (same layout idea as Codec 8E; count is 1 byte for Codec 16).
	if off >= len(b) {
		return off, event, io
	}
	n := int(b[off])
	off++
	for i := 0; i < n && off+4 <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		l := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		if off+l > len(b) {
			break
		}
		key := fmt.Sprintf("%d", id)
		switch l {
		case 0:
			io[key] = 0
		case 1, 2, 4, 8:
			io[key] = readIntBE(b[off:off+l], l)
		default:
			chunk := b[off : off+l]
			if isPrintableASCII(chunk) {
				io[key] = string(chunk)
			} else {
				io[key] = fmt.Sprintf("%x", chunk)
			}
		}
		off += l
	}
	return off, event, io
}

func readSizedIO16(b []byte, off, size int, io map[string]any) int {
	if off >= len(b) {
		return off
	}
	n := int(b[off])
	off++
	for i := 0; i < n && off+2+size <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

func extractIO8E(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off+2 > len(b) {
		return off, event, io
	}
	event = int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	if off+2 > len(b) {
		return off, event, io
	}
	off += 2 // total IO u16
	off = readSizedIO8E(b, off, 1, io)
	off = readSizedIO8E(b, off, 2, io)
	off = readSizedIO8E(b, off, 4, io)
	off = readSizedIO8E(b, off, 8, io)
	// NX variable
	if off+2 > len(b) {
		return off, event, io
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	for i := 0; i < n && off+4 <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		l := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		if off+l > len(b) {
			break
		}
		key := fmt.Sprintf("%d", id)
		switch l {
		case 0:
			io[key] = 0
		case 1, 2, 4, 8:
			io[key] = readIntBE(b[off:off+l], l)
		default:
			chunk := b[off : off+l]
			if isPrintableASCII(chunk) {
				io[key] = string(chunk)
			} else {
				io[key] = fmt.Sprintf("%x", chunk)
			}
		}
		off += l
	}
	return off, event, io
}

func readSizedIO8E(b []byte, off, size int, io map[string]any) int {
	if off+2 > len(b) {
		return off
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	for i := 0; i < n && off+2+size <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

func readIntBE(b []byte, size int) any {
	switch size {
	case 1:
		return int(b[0])
	case 2:
		return int(binary.BigEndian.Uint16(b))
	case 4:
		return int64(binary.BigEndian.Uint32(b))
	case 8:
		return int64(binary.BigEndian.Uint64(b))
	default:
		return fmt.Sprintf("%x", b)
	}
}

func isPrintableASCII(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	for _, c := range b {
		if c < 0x20 || c > 0x7e {
			return false
		}
	}
	return true
}

func asIOBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int:
		return t != 0
	case int64:
		return t != 0
	default:
		return false
	}
}

func asIOFloat(v any) float64 {
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
