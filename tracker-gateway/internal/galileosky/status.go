package galileosky

import (
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// applyStatusTags promotes 0x40–0x45 into remappable keys and returns safety events
// for high-confidence alarm bits (firmware-heuristic; still partial).
func applyStatusTags(tags map[byte][]byte, raw map[string]any) []*store.SafetyEvent {
	if raw == nil {
		return nil
	}
	var events []*store.SafetyEvent
	add := func(alarmType string, level int, attrs map[string]any) {
		events = append(events, &store.SafetyEvent{
			AlarmType:      alarmType,
			AlarmLevel:     level,
			RawAttrs:       attrs,
			SourceProtocol: "galileosky",
		})
	}
	for _, id := range []byte{0x40, 0x41, 0x42, 0x43, 0x44, 0x45} {
		v, ok := tags[id]
		if !ok || len(v) < 1 {
			continue
		}
		val := int(v[0])
		key := "tag.0x" + hex2(id)
		raw[key] = val
		raw["status."+key] = val
		switch id {
		case 0x40:
			if val&0x01 != 0 {
				raw["alarm.sos"] = true
				add("sos", 2, map[string]any{"alarm.sos": true, key: val})
			}
			if val&0x02 != 0 {
				raw["alarm.vibration"] = true
				add("vibration", 1, map[string]any{"alarm.vibration": true, key: val})
			}
		case 0x41:
			// Common: bit0 ignition / DIN1 on many Easy firmwares.
			raw["status.acc"] = val&0x01 != 0
			if val&0x01 != 0 {
				raw["ignition"] = true
			}
		case 0x42:
			if val&0x01 != 0 {
				raw["alarm.overspeed"] = true
				add("overspeed", 1, map[string]any{"alarm.overspeed": true, key: val})
			}
		case 0x43:
			if val&0x01 != 0 {
				raw["alarm.towing"] = true
				add("towing", 2, map[string]any{"alarm.towing": true, key: val})
			}
		case 0x44:
			// Firmware-variant status; expose bits without forcing safety unless SOS-like.
			raw["status.ext44"] = val
			if val&0x01 != 0 {
				raw["alarm.power_ext"] = true
				add("power_ext", 2, map[string]any{"alarm.power_ext": true, key: val})
			}
			if val&0x02 != 0 {
				raw["alarm.battery_low"] = true
				add("battery_low", 1, map[string]any{"alarm.battery_low": true, key: val})
			}
		case 0x45:
			raw["status.ext45"] = val
			if val&0x01 != 0 {
				raw["alarm.gsm_jamming"] = true
				add("jamming", 2, map[string]any{"alarm.gsm_jamming": true, key: val})
			}
		}
	}
	return events
}

func hex2(b byte) string {
	const h = "0123456789abcdef"
	return string([]byte{h[b>>4], h[b&0x0f]})
}
