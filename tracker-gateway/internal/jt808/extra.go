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
