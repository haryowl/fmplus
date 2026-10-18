package jt808

import (
	"encoding/binary"
	"fmt"
	"strings"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// parseAdditionalInfo walks JT/T 808 location additional-info TLVs after the 28-byte location core.
func parseAdditionalInfo(body []byte) map[string]any {
	if len(body) <= 28 {
		return map[string]any{}
	}
	return ParseAdditionalTLVBytes(body[28:])
}

// ParseAdditionalTLVBytes walks JT/T 808 additional-info TLVs (id u8, len u8, value) with no location prefix.
func ParseAdditionalTLVBytes(body []byte) map[string]any {
	add := map[string]any{}
	off := 0
	for off+2 <= len(body) {
		id := body[off]
		l := int(body[off+1])
		off += 2
		if off+l > len(body) {
			break
		}
		val := body[off : off+l]
		off += l
		key := fmt.Sprintf("0x%02x", id)
		switch id {
		case 0x01: // mileage 1/10 km
			if l >= 4 {
				km := float64(binary.BigEndian.Uint32(val)) / 10.0
				add[key] = km
				add["mileage"] = km
			}
		case 0x02: // fuel 1/10 L
			if l >= 2 {
				fuel := float64(binary.BigEndian.Uint16(val)) / 10.0
				add[key] = fuel
				add["fuel.level"] = fuel
			}
		case 0x03: // speed 1/10 km/h
			if l >= 2 {
				spd := float64(binary.BigEndian.Uint16(val)) / 10.0
				add[key] = spd
				add["speed.extra"] = spd
			}
		case 0x04: // manual confirm alarm event ID (WORD)
			if l >= 2 {
				id := int(binary.BigEndian.Uint16(val[0:2]))
				add[key] = id
				flattenManualAlarmID(id, add)
			} else if l >= 1 {
				id := int(val[0])
				add[key] = id
				flattenManualAlarmID(id, add)
			}
		case 0x05: // JT/T 808-2019 Table 27: tire pressure 30 bytes (Pa); short values = vendor oil fallback
			if l >= 30 {
				add[key] = fmt.Sprintf("%x", val)
				add["tire.pressure_hex"] = fmt.Sprintf("%x", val[:30])
				add["tire.pressure"] = true
			} else if l >= 4 {
				n := binary.BigEndian.Uint32(val)
				add[key] = int(n)
				add["oil.quantity"] = float64(n) / 10.0
			} else if l >= 2 {
				n := binary.BigEndian.Uint16(val)
				add[key] = int(n)
				add["oil.quantity"] = float64(n) / 10.0
			}
		case 0x06: // JT/T 808-2019 Table 27: compartment temp °C (signed int16; MSB=1 → negative)
			if l >= 2 {
				t := int16(binary.BigEndian.Uint16(val[0:2]))
				add[key] = int(t)
				add["temp.cargo"] = float64(t)
			}
		case 0x07: // pulse / recorder speed 1/10 km/h
			if l >= 2 {
				spd := float64(binary.BigEndian.Uint16(val)) / 10.0
				add[key] = spd
				add["speed.pulse"] = spd
			}
		case 0x11: // overspeed extra: loc type + optional region id
			if l >= 1 {
				add[key] = int(val[0])
				add["overspeed_loc_type"] = int(val[0])
				add["alarm.overspeed"] = true
			}
			if l >= 5 {
				add["overspeed_region_id"] = int(binary.BigEndian.Uint32(val[1:5]))
			}
		case 0x12: // in/out area/line
			if l >= 1 {
				add[key] = int(val[0])
				add["area_loc_type"] = int(val[0])
			}
			if l >= 6 {
				add["area_id"] = int(binary.BigEndian.Uint32(val[1:5]))
				dir := int(val[5])
				add["area_direction"] = dir
				if dir == 0 {
					add["alarm.fence_in"] = true
				} else {
					add["alarm.fence_out"] = true
				}
			}
		case 0x13: // JT/T 808-2019 Table 30: segment_id DWORD + drive_time WORD + result BYTE
			if l >= 7 {
				add[key] = int(val[6])
				add["route_id"] = int(binary.BigEndian.Uint32(val[0:4]))
				add["route_drive_time"] = int(binary.BigEndian.Uint16(val[4:6]))
				result := int(val[6])
				add["route_time_result"] = result
				if result == 0 {
					add["alarm.route_time_short"] = true
				} else {
					add["alarm.route_time_long"] = true
				}
			} else if l >= 1 {
				add[key] = int(val[0])
			}
		case 0x18, 0x19: // reserved in 808-2019 Table 27 (0x14–0x24); keep raw only
			add[key] = readBE(val)
		case 0x2a: // JT/T 808-2019 Table 32 IO status WORD (bit0 deep sleep, bit1 sleep)
			var io uint16
			if l >= 2 {
				io = binary.BigEndian.Uint16(val[0:2])
			} else if l >= 1 {
				io = uint16(val[0])
			}
			add[key] = int(io)
			add["io.status"] = int(io)
			add["status.deep_sleep"] = io&0x01 != 0
			add["status.sleep"] = io&0x02 != 0
		case 0x2b: // JT/T 808-2019 Table 27: bits0–15 AD0, bits16–31 AD1
			if l >= 4 {
				w := binary.BigEndian.Uint32(val)
				add[key] = int(w)
				ad0 := float64(w & 0xffff)
				ad1 := float64(w >> 16)
				add["analog.ad0"] = ad0
				add["analog.ad1"] = ad1
				add["analog.ad"] = ad0
				add["analog.ad2"] = ad1
			}
		case 0x32: // IC card / driver identity status (partial)
			if l >= 1 {
				st := int(val[0])
				add[key] = st
				add["driver.ic_status"] = st
				switch st {
				case 1:
					add["driver.ic_login"] = true
				case 2:
					add["driver.ic_logout"] = true
				}
			}
			if l >= 7 {
				bcd := val[1:7]
				add["driver.ic_time_bcd"] = fmt.Sprintf("%x", bcd)
				add["driver.ic_time"] = parseBcdTime(bcd).UTC().Format(time.RFC3339)
			}
			if l >= 8 {
				add["driver.ic_result"] = int(val[7])
			}
			if l >= 9 {
				nameLen := int(val[8])
				off := 9
				if nameLen > 0 && 9+nameLen <= l {
					add["driver.ic_name"] = strings.TrimSpace(string(val[9 : 9+nameLen]))
					off = 9 + nameLen
				}
				if off < l {
					// Remaining often certificate / card number ASCII.
					card := strings.TrimRight(string(val[off:]), "\x00 ")
					if card != "" {
						add["driver.ic_card"] = card
					}
				}
			}
		case 0x25: // JT/T 808-2019 Table 31 extended vehicle signal status bits
			if l >= 4 {
				sig := binary.BigEndian.Uint32(val)
				add[key] = sig
				add["status.low_beam"] = sig&0x01 != 0
				add["status.high_beam"] = sig&(1<<1) != 0
				add["status.right_turn"] = sig&(1<<2) != 0
				add["status.left_turn"] = sig&(1<<3) != 0
				add["status.brake"] = sig&(1<<4) != 0
				add["status.reverse"] = sig&(1<<5) != 0
				add["status.fog"] = sig&(1<<6) != 0
				add["status.position_lamp"] = sig&(1<<7) != 0
				add["status.horn"] = sig&(1<<8) != 0
				add["status.ac"] = sig&(1<<9) != 0
				add["status.neutral"] = sig&(1<<10) != 0
				add["status.retarder"] = sig&(1<<11) != 0
				add["status.abs"] = sig&(1<<12) != 0
				add["status.heater"] = sig&(1<<13) != 0
				add["status.clutch"] = sig&(1<<14) != 0
			}
		case 0x30: // wireless network signal strength
			if l >= 1 {
				n := int(val[0])
				add[key] = n
				add["gsm_signal"] = n
				add["gsm.signal"] = n
			}
		case 0x31: // GNSS satellite count
			if l >= 1 {
				n := int(val[0])
				add[key] = n
				add["gnss_sats"] = n
				add["gnss.sats"] = n
			}
		// 0x14–0x17 reserved in 808-2019 Table 27; kept for JT/T 1078 / vendor video extensions.
		case 0x14:
			if l >= 4 {
				w := binary.BigEndian.Uint32(val)
				add[key] = w
				decodeVideoAlarmWord(w, add)
			} else {
				add[key] = fmt.Sprintf("%x", val)
			}
		case 0x15:
			if l >= 4 {
				w := binary.BigEndian.Uint32(val)
				add[key] = w
				add["video.signal_loss"] = w
				if w != 0 {
					add["alarm.video_loss"] = true
				}
			} else {
				add[key] = fmt.Sprintf("%x", val)
			}
		case 0x16:
			if l >= 4 {
				w := binary.BigEndian.Uint32(val)
				add[key] = w
				add["video.signal_occlude"] = w
				if w != 0 {
					add["alarm.video_occlude"] = true
				}
			} else {
				add[key] = fmt.Sprintf("%x", val)
			}
		case 0x17:
			if l >= 4 {
				w := binary.BigEndian.Uint32(val)
				add[key] = w
				add["video.storage_fault"] = w
				if w != 0 {
					add["alarm.video_storage"] = true
				}
			} else {
				add[key] = fmt.Sprintf("%x", val)
			}
		case 0x64, 0x65, 0x66, 0x67: // Su Biao ADAS/DSM/TPMS/BSD (vendor length varies)
			add[key] = fmt.Sprintf("%x", val)
			add["subiao_type"] = key
			decodeSubiaoBody(id, val, add)
		default:
			if l <= 8 {
				add[key] = readBE(val)
			} else {
				add[key] = fmt.Sprintf("%x", val)
			}
		}
	}
	return add
}

func readBE(val []byte) any {
	switch len(val) {
	case 1:
		return int(val[0])
	case 2:
		return int(binary.BigEndian.Uint16(val))
	case 4:
		return int64(binary.BigEndian.Uint32(val))
	default:
		return fmt.Sprintf("%x", val)
	}
}

type alarmBit struct {
	bit   uint32
	name  string
	level int
	key   string
}

// jt808AlarmBits follows JT/T 808—2019 Table 25 (报警预警标志位定义). Bit 31 reserved.
var jt808AlarmBits = []alarmBit{
	{1 << 0, "sos", 2, "alarm.sos"},
	{1 << 1, "overspeed", 1, "alarm.overspeed"},
	{1 << 2, "fatigue", 2, "alarm.fatigue"},
	{1 << 3, "danger_driving", 2, "alarm.danger_driving"},
	{1 << 4, "gnss_module", 1, "alarm.gnss_module"},
	{1 << 5, "gnss_antenna_cut", 2, "alarm.gnss_antenna_cut"},
	{1 << 6, "gnss_short", 1, "alarm.gnss_short"},
	{1 << 7, "low_power", 1, "alarm.low_power"},
	{1 << 8, "power_cut", 2, "alarm.power_cut"},
	{1 << 9, "lcd_fault", 1, "alarm.lcd_fault"},
	{1 << 10, "tts_fault", 1, "alarm.tts_fault"},
	{1 << 11, "camera_fault", 1, "alarm.camera_fault"},
	{1 << 12, "road_ic", 1, "alarm.road_ic"},
	{1 << 13, "overspeed_warn", 1, "alarm.overspeed_warn"},
	{1 << 14, "fatigue_warn", 1, "alarm.fatigue_warn"},
	{1 << 15, "illegal_driving", 1, "alarm.illegal_driving"},
	{1 << 16, "tire_pressure_warn", 1, "alarm.tire_pressure_warn"},
	{1 << 17, "right_blind_zone", 1, "alarm.right_blind_zone"},
	{1 << 18, "day_drive_timeout", 1, "alarm.day_drive_timeout"},
	{1 << 19, "parking_timeout", 1, "alarm.parking_timeout"},
	{1 << 20, "area_in_out", 1, "alarm.area_in_out"},
	{1 << 21, "route_in_out", 1, "alarm.route_in_out"},
	{1 << 22, "route_drive_time", 1, "alarm.route_drive_time"},
	{1 << 23, "route_deviation", 1, "alarm.route_deviation"},
	{1 << 24, "vss_fault", 1, "alarm.vss_fault"},
	{1 << 25, "fuel_abnormal", 2, "alarm.fuel_abnormal"},
	{1 << 26, "theft", 2, "alarm.theft"},
	{1 << 27, "illegal_ignition", 2, "alarm.illegal_ignition"},
	{1 << 28, "illegal_move", 1, "alarm.illegal_move"},
	{1 << 29, "collision_rollover", 2, "alarm.collision_rollover"},
	{1 << 30, "rollover_warn", 2, "alarm.rollover_warn"},
}

// flattenAlarmBits writes remappable alarm.* bool keys into dest (fix raw_attrs / safety).
func flattenAlarmBits(alarm uint32, dest map[string]any) {
	if alarm == 0 || dest == nil {
		return
	}
	for _, b := range jt808AlarmBits {
		if alarm&b.bit != 0 {
			dest[b.key] = true
		}
	}
}

// safetyFromAlarmWord maps JT/T 808 location alarm dword bits to a safety event.
func safetyFromAlarmWord(alarm uint32, fix store.Fix, protocol string) *store.SafetyEvent {
	if alarm == 0 {
		return nil
	}
	raw := map[string]any{"alarm_word": alarm}
	flattenAlarmBits(alarm, raw)
	alarmType := "jt808_alarm"
	level := 1
	for _, b := range jt808AlarmBits {
		if alarm&b.bit != 0 {
			alarmType = b.name
			level = b.level
			break
		}
	}
	raw["alarm_level"] = level
	lat, lon := fix.Lat, fix.Lon
	return &store.SafetyEvent{
		RecordedAt:     fix.RecordedAt,
		AlarmType:      alarmType,
		AlarmLevel:     level,
		Lat:            &lat,
		Lon:            &lon,
		RawAttrs:       raw,
		SourceProtocol: protocol,
	}
}

// decodeSubiaoBody extracts event type/level and remappable adas.*/dsm.*/bsd.* keys.
// Common compact layout: byte0 = event type, byte1 = alarm level (1|2). Vendor bodies vary.
func decodeSubiaoBody(id byte, val []byte, add map[string]any) {
	if len(val) == 0 {
		return
	}
	eventType := int(val[0])
	level := 1
	if len(val) >= 2 {
		level = int(val[1])
		if level < 1 || level > 3 {
			// Some firmwares put level first then type.
			if val[0] >= 1 && val[0] <= 3 {
				level = int(val[0])
				eventType = int(val[1])
			} else {
				level = 1
			}
		}
	} else if eventType >= 1 && eventType <= 3 && len(val) == 1 {
		// Ambiguous single-byte: treat as level only (legacy).
		level = eventType
		eventType = 0
	}
	add["subiao_level"] = level
	add["subiao_event_id"] = eventType
	add["alarm_level"] = level

	switch id {
	case 0x64: // ADAS
		key, name := adasEventKey(eventType)
		add["subiao_event"] = name
		if key != "" {
			add[key] = true
		}
	case 0x65: // DSM
		key, name := dsmEventKey(eventType)
		add["subiao_event"] = name
		if key != "" {
			add[key] = true
		}
	case 0x66: // TPMS
		add["subiao_event"] = "tpms"
		add["tpms.alarm"] = true
	case 0x67: // BSD
		key, name := bsdEventKey(eventType)
		add["subiao_event"] = name
		if key != "" {
			add[key] = true
		}
		add["bsd.blind"] = true
	}
}

// flattenManualAlarmID maps TLV 0x04 event id onto remappable alarm.* (same table as 0x0301).
func flattenManualAlarmID(id int, add map[string]any) {
	if add == nil || id == 0 {
		return
	}
	add["manual_alarm_id"] = id
	ev := safetyFromEventID(id, "jt808")
	if ev == nil {
		return
	}
	for k, v := range ev.RawAttrs {
		if strings.HasPrefix(k, "alarm.") {
			add[k] = v
		}
	}
	if ev.AlarmLevel > 0 {
		add["alarm_level"] = ev.AlarmLevel
	}
}

// HoistLocationStatusBits exports location status DWORD remaps for other adapters (e.g. JT809).
func HoistLocationStatusBits(status uint32, dest map[string]any) {
	hoistLocationStatusBits(status, dest)
}

// hoistLocationStatusBits maps JT/T 808—2019 Table 24 status DWORD bits onto remappable keys.
func hoistLocationStatusBits(status uint32, raw map[string]any) {
	if raw == nil {
		return
	}
	if status&0x04 != 0 {
		raw["status.south"] = true
	}
	if status&0x08 != 0 {
		raw["status.west"] = true
	}
	if status&0x10 != 0 {
		raw["status.out_of_service"] = true
	}
	if status&0x20 != 0 {
		raw["status.encrypted"] = true
	}
	// Bits 6–7 (2019): forward collision / lane departure early-warning from braking system.
	if status&(1<<6) != 0 {
		raw["status.fcw"] = true
		raw["adas.fcw"] = true
	}
	if status&(1<<7) != 0 {
		raw["status.ldw"] = true
		raw["adas.ldw"] = true
	}
	// Bits 8–9: load (00 empty, 01 half, 10 reserved, 11 full).
	switch (status >> 8) & 0x03 {
	case 0:
		raw["vehicle.load"] = "empty"
	case 1:
		raw["vehicle.load"] = "half"
		raw["status.load_half"] = true
	case 2:
		raw["vehicle.load"] = "reserved"
		raw["status.load_reserved"] = true
	case 3:
		raw["vehicle.load"] = "full"
		raw["status.load_full"] = true
	}
	if status&0x0400 != 0 {
		raw["status.oil_cut"] = true
	}
	if status&0x0800 != 0 {
		raw["status.circuit_cut"] = true
	}
	if status&0x1000 != 0 {
		raw["status.door_lock"] = true
	}
	if status&0x2000 != 0 {
		raw["status.door1"] = true
	}
	if status&0x4000 != 0 {
		raw["status.door2"] = true
	}
	if status&0x8000 != 0 {
		raw["status.door3"] = true
	}
	if status&0x10000 != 0 {
		raw["status.door4"] = true
	}
	if status&0x20000 != 0 {
		raw["status.door5"] = true
	}
	if status&(0x2000|0x4000|0x8000|0x10000|0x20000) != 0 {
		raw["status.door"] = true
	}
	if status&0x40000 != 0 {
		raw["status.gnss_gps"] = true
	}
	if status&0x80000 != 0 {
		raw["status.gnss_beidou"] = true
	}
	if status&0x100000 != 0 {
		raw["status.gnss_glonass"] = true
	}
	if status&0x200000 != 0 {
		raw["status.gnss_galileo"] = true
	}
	// Bit 22 (2019): 0 stopped / 1 moving.
	raw["status.moving"] = status&(1<<22) != 0
}

func isRemappableSafetyKey(k string) bool {
	switch k {
	case "alarm_level", "tpms.alarm", "gsm_signal", "gsm.signal", "gnss_sats", "gnss.sats",
		"overspeed_loc_type", "overspeed_region_id", "area_loc_type", "area_id", "area_direction",
		"mileage", "fuel.level", "speed.extra", "speed.pulse", "io.status", "manual_alarm_id",
		"oil.quantity", "temp.cargo", "analog.ad", "analog.ad0", "analog.ad1", "analog.ad2", "vehicle.load",
		"route_id", "route_time_result", "route_drive_time", "tire.pressure", "tire.pressure_hex",
		"driver.ic_status", "driver.ic_card", "driver.ic_name", "driver.ic_result", "driver.ic_time_bcd", "driver.ic_time":
		return true
	}
	return strings.HasPrefix(k, "adas.") ||
		strings.HasPrefix(k, "dsm.") ||
		strings.HasPrefix(k, "bsd.") ||
		strings.HasPrefix(k, "alarm.") ||
		strings.HasPrefix(k, "status.") ||
		strings.HasPrefix(k, "video.") ||
		strings.HasPrefix(k, "driver.") ||
		strings.HasPrefix(k, "gnss.") ||
		strings.HasPrefix(k, "tire.") ||
		strings.HasPrefix(k, "vehicle.")
}

// FlattenAlarmBits exports location/GNSS alarm dword remaps for other adapters (e.g. JT809).
func FlattenAlarmBits(alarm uint32, dest map[string]any) {
	flattenAlarmBits(alarm, dest)
}

// SafetyFromAlarmWord exports alarm-dword → safety for cross-protocol reuse (JT809 GNSS).
func SafetyFromAlarmWord(alarm uint32, fix store.Fix, protocol string) *store.SafetyEvent {
	return safetyFromAlarmWord(alarm, fix, protocol)
}

// HoistLocationTLV copies remappable location additional-info keys onto fix raw_attrs top-level.
func HoistLocationTLV(add, dest map[string]any) {
	hoistLocationTLV(add, dest)
}

func hoistLocationTLV(add, dest map[string]any) {
	if add == nil || dest == nil {
		return
	}
	for k, v := range add {
		if isRemappableSafetyKey(k) {
			dest[k] = v
		}
	}
}

// decodeVideoAlarmWord maps 0x14 video-related alarm bits onto remappable keys (partial).
func decodeVideoAlarmWord(w uint32, add map[string]any) {
	if w == 0 || add == nil {
		return
	}
	add["video.alarm_word"] = w
	bits := []struct {
		bit uint32
		key string
	}{
		{1 << 0, "alarm.video_loss"},
		{1 << 1, "alarm.video_occlude"},
		{1 << 2, "alarm.video_storage"},
		{1 << 3, "alarm.video_other_device"},
		{1 << 4, "alarm.video_overload"},
		{1 << 5, "alarm.video_encode"},
		{1 << 6, "alarm.video_illegal_access"},
		{1 << 7, "alarm.video_storage_fault"},
	}
	for _, b := range bits {
		if w&b.bit != 0 {
			add[b.key] = true
		}
	}
}

func adasEventKey(eventType int) (key, name string) {
	switch eventType {
	case 1:
		return "adas.fcw", "fcw"
	case 2:
		return "adas.ldw", "ldw"
	case 3:
		return "adas.close", "close_vehicle"
	case 4:
		return "adas.pcw", "pcw"
	case 5:
		return "adas.lane_change", "frequent_lane_change"
	case 6:
		return "adas.road_sign", "road_sign"
	case 7:
		return "adas.obstacle", "obstacle"
	default:
		if eventType == 0 {
			return "adas.fcw", "adas" // unknown → keep FCW remap path usable
		}
		return "adas.other", fmt.Sprintf("adas_%d", eventType)
	}
}

func dsmEventKey(eventType int) (key, name string) {
	switch eventType {
	case 1:
		return "dsm.fatigue", "fatigue"
	case 2:
		return "dsm.phone", "phone"
	case 3:
		return "dsm.smoke", "smoke"
	case 4:
		return "dsm.distract", "distract"
	case 5:
		return "dsm.driver", "driver_abnormal"
	default:
		if eventType == 0 {
			return "dsm.fatigue", "dsm"
		}
		return "dsm.other", fmt.Sprintf("dsm_%d", eventType)
	}
}

func bsdEventKey(eventType int) (key, name string) {
	switch eventType {
	case 1:
		return "bsd.rear", "rear"
	case 2:
		return "bsd.left", "left_rear"
	case 3:
		return "bsd.right", "right_rear"
	default:
		return "bsd.blind", "bsd"
	}
}

func safetyFromAdditional(add map[string]any, fix store.Fix, protocol string) *store.SafetyEvent {
	subType, _ := add["subiao_type"].(string)
	if subType != "" {
		level, _ := add["subiao_level"].(int)
		if level < 1 {
			level = 1
		}
		alarmType := map[string]string{
			"0x64": "adas",
			"0x65": "dsm",
			"0x66": "tpms",
			"0x67": "bsd",
		}[subType]
		if alarmType == "" {
			alarmType = "subiao_" + subType
		}
		if ev, _ := add["subiao_event"].(string); ev != "" && ev != alarmType {
			alarmType = alarmType + "_" + ev
		}
		lat, lon := fix.Lat, fix.Lon
		raw := map[string]any{}
		for k, v := range add {
			raw[k] = v
		}
		raw["alarm_level"] = level
		return &store.SafetyEvent{
			RecordedAt:     fix.RecordedAt,
			AlarmType:      alarmType,
			AlarmLevel:     level,
			Lat:            &lat,
			Lon:            &lon,
			RawAttrs:       raw,
			SourceProtocol: protocol,
		}
	}
	if ev := safetyFromVideoAdditional(add, fix, protocol); ev != nil {
		return ev
	}
	return safetyFromLocationTLVAlarms(add, fix, protocol)
}

func safetyFromLocationTLVAlarms(add map[string]any, fix store.Fix, protocol string) *store.SafetyEvent {
	if add == nil {
		return nil
	}
	pairs := []struct {
		key   string
		name  string
		level int
	}{
		{"alarm.sos", "sos", 2},
		{"alarm.overspeed", "overspeed", 1},
		{"alarm.fence_in", "fence_in", 1},
		{"alarm.fence_out", "fence_out", 1},
		{"alarm.route_time_short", "route_time_short", 1},
		{"alarm.route_time_long", "route_time_long", 1},
		{"driver.ic_login", "driver_ic_login", 1},
		{"driver.ic_logout", "driver_ic_logout", 1},
	}
	for _, p := range pairs {
		if add[p.key] != true {
			continue
		}
		lat, lon := fix.Lat, fix.Lon
		raw := map[string]any{p.key: true, "alarm_level": p.level}
		if id, ok := add["manual_alarm_id"]; ok {
			raw["manual_alarm_id"] = id
		}
		if id, ok := add["area_id"]; ok {
			raw["area_id"] = id
		}
		if id, ok := add["route_id"]; ok {
			raw["route_id"] = id
		}
		return &store.SafetyEvent{
			RecordedAt:     fix.RecordedAt,
			AlarmType:      p.name,
			AlarmLevel:     p.level,
			Lat:            &lat,
			Lon:            &lon,
			RawAttrs:       raw,
			SourceProtocol: protocol,
		}
	}
	return nil
}

func safetyFromVideoAdditional(add map[string]any, fix store.Fix, protocol string) *store.SafetyEvent {
	if add == nil {
		return nil
	}
	pairs := []struct {
		key  string
		name string
	}{
		{"alarm.video_loss", "video_loss"},
		{"alarm.video_occlude", "video_occlude"},
		{"alarm.video_storage", "video_storage"},
		{"alarm.video_storage_fault", "video_storage"},
		{"alarm.video_other_device", "video_other_device"},
		{"alarm.video_illegal_access", "video_illegal_access"},
		{"alarm.video_encode", "video_encode"},
		{"alarm.video_overload", "video_overload"},
	}
	alarmType := ""
	for _, p := range pairs {
		if add[p.key] == true {
			alarmType = p.name
			break
		}
	}
	if alarmType == "" {
		return nil
	}
	lat, lon := fix.Lat, fix.Lon
	raw := map[string]any{"alarm_level": 2}
	for k, v := range add {
		if strings.HasPrefix(k, "alarm.video") || strings.HasPrefix(k, "video.") ||
			k == "0x14" || k == "0x15" || k == "0x16" || k == "0x17" {
			raw[k] = v
		}
	}
	return &store.SafetyEvent{
		RecordedAt:     fix.RecordedAt,
		AlarmType:      alarmType,
		AlarmLevel:     2,
		Lat:            &lat,
		Lon:            &lon,
		RawAttrs:       raw,
		SourceProtocol: protocol,
	}
}
