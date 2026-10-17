package teltonika

import (
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type knownEvent struct {
	name  string
	level int
	key   string
}

// knownEventIO maps common FMB / Codec AVL event IDs (partial — model configs vary).
var knownEventIO = map[int]knownEvent{
	175: {"geofence", 1, "alarm.geofence"},
	236: {"alarm", 2, "alarm.generic"},
	240: {"movement", 1, "alarm.movement"},
	246: {"towing", 2, "alarm.towing"},
	247: {"crash", 2, "alarm.crash"},
	249: {"jamming", 2, "alarm.jamming"},
	251: {"idling", 1, "alarm.idling"},
	252: {"unplug", 2, "alarm.unplug"},
	253: {"green_driving", 1, "alarm.green_driving"},
	254: {"trip", 1, "alarm.trip"},
	255: {"overspeed", 1, "alarm.overspeed"},
	1:   {"sos", 2, "alarm.sos"},       // DIN1 / SOS on many configs
	2:   {"door", 1, "alarm.door"},     // DIN2 / door on many configs
	3:   {"door", 1, "alarm.door"},
	9:   {"sos", 2, "alarm.sos"},       // alternate SOS event id
	14:  {"door", 1, "alarm.door"},
	15:  {"door", 1, "alarm.door"},
	66:  {"ext_voltage", 1, "alarm.ext_voltage"},
	239: {"ignition", 1, "alarm.ignition"}, // event-mode ignition change
	243: {"green_driving", 1, "alarm.green_driving_duration"},
}

// flattenEventAlarm writes remappable alarm.* onto fix raw_attrs when event_io is known.
func flattenEventAlarm(raw map[string]any) {
	if raw == nil {
		return
	}
	eid, ok := asEventID(raw["event_io"])
	if !ok || eid == 0 {
		return
	}
	k, ok := knownEventIO[eid]
	if !ok {
		return
	}
	raw[k.key] = true
	raw["alarm_level"] = k.level
}

// safetyFromEventIO raises a safety event for known high-signal AVL event IDs.
func safetyFromEventIO(fix store.Fix) *store.SafetyEvent {
	if fix.RawAttrs == nil {
		return nil
	}
	eid, ok := asEventID(fix.RawAttrs["event_io"])
	if !ok || eid == 0 {
		return nil
	}
	k, ok := knownEventIO[eid]
	if !ok {
		return nil
	}
	lat, lon := fix.Lat, fix.Lon
	raw := map[string]any{
		"event_io":    eid,
		"alarm_level": k.level,
		k.key:         true,
	}
	return &store.SafetyEvent{
		RecordedAt:     fix.RecordedAt,
		AlarmType:      k.name,
		AlarmLevel:     k.level,
		Lat:            &lat,
		Lon:            &lon,
		RawAttrs:       raw,
		SourceProtocol: "teltonika",
	}
}

func asEventID(v any) (int, bool) {
	switch t := v.(type) {
	case int:
		return t, true
	case int64:
		return int(t), true
	case float64:
		return int(t), true
	case string:
		var n int
		if _, err := fmt.Sscanf(t, "%d", &n); err == nil {
			return n, true
		}
	}
	return 0, false
}
