package jt808

import (
	"encoding/binary"
	"fmt"

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
		case 0x14, 0x15, 0x16, 0x17: // video / alarm related
			add[key] = fmt.Sprintf("%x", val)
		case 0x64, 0x65, 0x66, 0x67: // Su Biao ADAS/DSM/BSD style bodies (vendor length varies)
			add[key] = fmt.Sprintf("%x", val)
			add["subiao_type"] = key
			if l >= 1 {
				add["subiao_level"] = int(val[0])
			}
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

func safetyFromAdditional(add map[string]any, fix store.Fix, protocol string) *store.SafetyEvent {
	subType, _ := add["subiao_type"].(string)
	if subType == "" {
		return nil
	}
	level, _ := add["subiao_level"].(int)
	alarmType := map[string]string{
		"0x64": "adas",
		"0x65": "dsm",
		"0x66": "tpms",
		"0x67": "bsd",
	}[subType]
	if alarmType == "" {
		alarmType = "subiao_" + subType
	}
	lat, lon := fix.Lat, fix.Lon
	raw := map[string]any{}
	for k, v := range add {
		raw[k] = v
	}
	// Remappable vendor keys for Device Manager Su Biao profiles.
	switch subType {
	case "0x64":
		raw["adas.fcw"] = true
	case "0x65":
		raw["dsm.fatigue"] = true
	case "0x67":
		raw["bsd.blind"] = true
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
