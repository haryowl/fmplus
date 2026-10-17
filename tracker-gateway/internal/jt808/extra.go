package jt808

import (
	"encoding/binary"
	"fmt"
	"strings"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// parseAdditionalInfo walks JT/T 808 location additional-info TLVs (id u8, len u8, value).
func parseAdditionalInfo(body []byte) map[string]any {
	add := map[string]any{}
	if len(body) <= 28 {
		return add
	}
	off := 28
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
				add[key] = float64(binary.BigEndian.Uint32(val)) / 10.0
			}
		case 0x02: // fuel 1/10 L
			if l >= 2 {
				add[key] = float64(binary.BigEndian.Uint16(val)) / 10.0
			}
		case 0x03: // speed 1/10 km/h
			if l >= 2 {
				add[key] = float64(binary.BigEndian.Uint16(val)) / 10.0
			}
		case 0x11: // overspeed extra: loc type + optional region id
			if l >= 1 {
				add["overspeed_loc_type"] = int(val[0])
				add["alarm.overspeed"] = true
			}
			if l >= 5 {
				add["overspeed_region_id"] = int(binary.BigEndian.Uint32(val[1:5]))
			}
		case 0x12: // in/out area/line
			if l >= 1 {
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
		case 0x25: // extended vehicle signal status bits
			if l >= 4 {
				sig := binary.BigEndian.Uint32(val)
				add[key] = sig
				add["status.acc"] = sig&0x01 != 0
				add["status.door"] = sig&0x0400 != 0 || sig&0x1000 != 0
				add["status.low_beam"] = sig&0x0100 != 0
				add["status.high_beam"] = sig&0x0200 != 0
			}
		case 0x30: // wireless network signal strength
			if l >= 1 {
				add["gsm_signal"] = int(val[0])
			}
		case 0x31: // GNSS satellite count
			if l >= 1 {
				add["gnss_sats"] = int(val[0])
			}
		case 0x14, 0x15, 0x16, 0x17: // video / alarm related
			add[key] = fmt.Sprintf("%x", val)
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

var jt808AlarmBits = []alarmBit{
	{1 << 0, "sos", 2, "alarm.sos"},
	{1 << 1, "overspeed", 1, "alarm.overspeed"},
	{1 << 2, "fatigue", 2, "alarm.fatigue"},
	{1 << 3, "fatigue_early", 1, "alarm.fatigue_early"},
	{1 << 4, "gnss_antenna", 1, "alarm.gnss_antenna"},
	{1 << 5, "gnss_antenna_cut", 2, "alarm.gnss_antenna_cut"},
	{1 << 7, "low_power", 1, "alarm.low_power"},
	{1 << 8, "power_cut", 2, "alarm.power_cut"},
	{1 << 20, "collision", 2, "alarm.collision"},
	{1 << 21, "rollover", 2, "alarm.rollover"},
	{1 << 28, "illegal_ignition", 2, "alarm.illegal_ignition"},
	{1 << 29, "illegal_move", 1, "alarm.illegal_move"},
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

func isRemappableSafetyKey(k string) bool {
	if k == "alarm_level" || k == "tpms.alarm" {
		return true
	}
	return strings.HasPrefix(k, "adas.") ||
		strings.HasPrefix(k, "dsm.") ||
		strings.HasPrefix(k, "bsd.")
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
	if subType == "" {
		return nil
	}
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
