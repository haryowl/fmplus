package httpingest

import (
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Known JSON/vendor alarm keys → type + severity (parity with TCP adapters).
var jsonAlarmKeys = []struct {
	key   string
	name  string
	level int
}{
	{"alarm.sos", "sos", 2},
	{"alarm.crash", "crash", 2},
	{"alarm.collision", "collision", 2},
	{"alarm.power_cut", "power_cut", 2},
	{"alarm.rollover", "rollover", 2},
	{"alarm.fatigue", "fatigue", 2},
	{"alarm.overspeed", "overspeed", 1},
	{"alarm.towing", "towing", 1},
	{"alarm.jamming", "jamming", 1},
	{"alarm.vibration", "vibration", 1},
	{"alarm.illegal_move", "illegal_move", 1},
	{"alarm.fence_in", "fence_in", 1},
	{"alarm.fence_out", "fence_out", 1},
}

// Teltonika-style event_io IDs that HTTP clients may send after flatten.
var jsonEventIOAlarms = map[int]struct {
	name  string
	level int
}{
	246: {"towing", 1},
	247: {"crash", 2},
	249: {"jamming", 1},
	255: {"overspeed", 1},
}

// safetyFromJSONAttrs raises a safety event when flattened alarm.* or event_io is set.
func safetyFromJSONAttrs(fix store.Fix) *store.SafetyEvent {
	raw := fix.RawAttrs
	if raw == nil {
		return nil
	}
	for _, a := range jsonAlarmKeys {
		if !asBool(raw[a.key]) {
			continue
		}
		out := map[string]any{a.key: true}
		lat, lon := fix.Lat, fix.Lon
		return &store.SafetyEvent{
			RecordedAt:     fix.RecordedAt,
			AlarmType:      a.name,
			AlarmLevel:     a.level,
			Lat:            &lat,
			Lon:            &lon,
			RawAttrs:       out,
			SourceProtocol: "json",
		}
	}
	if eid := asInt(raw["event_io"]); eid != nil {
		if m, ok := jsonEventIOAlarms[*eid]; ok {
			out := map[string]any{"event_io": *eid, "alarm." + m.name: true}
			lat, lon := fix.Lat, fix.Lon
			return &store.SafetyEvent{
				RecordedAt:     fix.RecordedAt,
				AlarmType:      m.name,
				AlarmLevel:     m.level,
				Lat:            &lat,
				Lon:            &lon,
				RawAttrs:       out,
				SourceProtocol: "json",
			}
		}
	}
	return nil
}
