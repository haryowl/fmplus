package galileosky

import (
	"encoding/binary"
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// applyStatusTags promotes official tags 0x40–0x47 into remappable keys and safety events.
// Bit meanings for 0x40 follow Galileosky §8 device-status decode (Table 13).
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

	if v, ok := tags[0x40]; ok && len(v) >= 2 {
		st := binary.LittleEndian.Uint16(v[0:2])
		raw["tag.0x40"] = int(st)
		raw["status.tag.0x40"] = int(st)
		raw["status.device"] = int(st)
		// bit0: movement (AccSens), not SOS
		moving := st&0x0001 != 0
		raw["status.moving"] = moving
		raw["movement"] = moving
		if st&0x0002 != 0 {
			raw["alarm.tilt"] = true
			add("tilt", 1, map[string]any{"alarm.tilt": true, "tag.0x40": int(st)})
		}
		if st&0x0004 != 0 {
			raw["status.ibutton_trusted"] = true
		}
		if st&0x0008 != 0 {
			raw["alarm.sim_missing"] = true
			add("sim_missing", 1, map[string]any{"alarm.sim_missing": true, "tag.0x40": int(st)})
		}
		if st&0x0010 != 0 {
			raw["status.geofence"] = true
		}
		if st&0x0020 != 0 {
			raw["alarm.battery_low"] = true
			add("battery_low", 1, map[string]any{"alarm.battery_low": true, "tag.0x40": int(st)})
		}
		if st&0x0040 != 0 {
			raw["alarm.gnss_antenna"] = true
			add("gnss_antenna", 1, map[string]any{"alarm.gnss_antenna": true, "tag.0x40": int(st)})
		}
		if st&0x0080 != 0 {
			raw["alarm.bus_voltage"] = true
			add("bus_voltage", 1, map[string]any{"alarm.bus_voltage": true, "tag.0x40": int(st)})
		}
		if st&0x0100 != 0 {
			raw["alarm.power_ext"] = true
			add("power_ext", 2, map[string]any{"alarm.power_ext": true, "tag.0x40": int(st)})
		}
		if st&0x0200 != 0 {
			raw["status.acc"] = true
			raw["status.ignition"] = true
			raw["ignition"] = true
		}
		if st&0x0400 != 0 {
			raw["alarm.impact"] = true
			add("impact", 2, map[string]any{"alarm.impact": true, "tag.0x40": int(st)})
		}
		if st&0x0800 != 0 {
			raw["gnss.glonass"] = true
		}
		raw["gsm.signal_q"] = int((st >> 12) & 0x03)
		if st&0x4000 != 0 {
			raw["status.alarm_mode"] = true
		}
		if st&0x8000 != 0 {
			raw["alarm.sos"] = true
			add("sos", 2, map[string]any{"alarm.sos": true, "tag.0x40": int(st)})
		}
	} else if v, ok := tags[0x40]; ok && len(v) >= 1 {
		// Truncated / legacy 1-byte view — expose raw only.
		raw["tag.0x40"] = int(v[0])
		raw["status.tag.0x40"] = int(v[0])
	}

	if v, ok := tags[0x41]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		raw["tag.0x41"] = mv
		raw["voltage.supply"] = mv / 1000.0
		raw["voltage.ext"] = mv / 1000.0
	}
	if v, ok := tags[0x42]; ok && len(v) >= 2 {
		mv := float64(binary.LittleEndian.Uint16(v[0:2]))
		raw["tag.0x42"] = mv
		raw["voltage.batt"] = mv / 1000.0
	}
	if v, ok := tags[0x43]; ok && len(v) >= 1 {
		t := int(int8(v[0]))
		raw["tag.0x43"] = t
		raw["temp.device"] = float64(t)
	}
	if v, ok := tags[0x44]; ok && len(v) >= 4 {
		u := binary.LittleEndian.Uint32(v[0:4])
		raw["tag.0x44"] = int64(u)
		// 10-bit axes; 512 = 0g; scale 1g = 186
		ax := int(u & 0x3ff)
		ay := int((u >> 10) & 0x3ff)
		az := int((u >> 20) & 0x3ff)
		raw["accel.x"] = float64(ax-512) / 186.0
		raw["accel.y"] = float64(ay-512) / 186.0
		raw["accel.z"] = float64(az-512) / 186.0
	}
	if v, ok := tags[0x45]; ok && len(v) >= 1 {
		raw["tag.0x45"] = int(v[0])
		raw["status.outputs"] = int(v[0])
		raw["status.tag.0x45"] = int(v[0])
		for i := 0; i < 8; i++ {
			raw[fmt.Sprintf("status.dout%d", i)] = v[0]&(1<<uint(i)) != 0
		}
		if len(v) >= 2 {
			comp := int(v[0]) | (int(v[1]) << 8)
			raw["tag.0x45"] = comp
			raw["status.tag.0x45"] = comp
			raw["status.outputs_hi"] = int(v[1])
			for i := 0; i < 8; i++ {
				raw[fmt.Sprintf("status.dout%d", i+8)] = v[1]&(1<<uint(i)) != 0
			}
		}
	}
	if v, ok := tags[0x47]; ok && len(v) >= 4 {
		raw["tag.0x47"] = int(binary.LittleEndian.Uint32(v[0:4]))
		// Official: units where 100 = 1g = 9.8 m/s².
		raw["ecodrive.accel"] = float64(v[0]) / 100.0
		raw["ecodrive.brake"] = float64(v[1]) / 100.0
		raw["ecodrive.turn"] = float64(v[2]) / 100.0
		raw["ecodrive.bump"] = float64(v[3]) / 100.0
		raw["ecodrive.accel_raw"] = int(v[0])
		raw["ecodrive.brake_raw"] = int(v[1])
		raw["ecodrive.turn_raw"] = int(v[2])
		raw["ecodrive.bump_raw"] = int(v[3])
	}
	return events
}
