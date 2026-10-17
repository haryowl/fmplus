package ruptela

import (
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// safetyFromEventIO raises a safety event for known high-signal Ruptela event IDs.
// IO IDs are model/config dependent; Device Manager can remap alarm.* on safety raw_attrs.
func safetyFromEventIO(fix store.Fix) *store.SafetyEvent {
	if fix.RawAttrs == nil {
		return nil
	}
	eid, ok := asEventID(fix.RawAttrs["event_io"])
	if !ok || eid == 0 {
		return nil
	}
	type known struct {
		name  string
		level int
		key   string
	}
	// Overlap with Teltonika AVL where Ruptela FM configs share IO numbering.
	m := map[int]known{
		236: {"alarm", 2, "alarm.generic"},
		246: {"towing", 2, "alarm.towing"},
		247: {"crash", 2, "alarm.crash"},
		249: {"jamming", 2, "alarm.jamming"},
		251: {"idling", 1, "alarm.idling"},
		252: {"unplug", 2, "alarm.unplug"},
		253: {"green_driving", 1, "alarm.green_driving"},
		255: {"overspeed", 1, "alarm.overspeed"},
		175: {"geofence", 1, "alarm.geofence"},
		5:   {"ignition", 1, "alarm.ignition"},
	}
	k, ok := m[eid]
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
		SourceProtocol: "ruptela",
	}
}

func asEventID(v any) (int, bool) {
	switch t := v.(type) {
	case int:
		return t, true
	case int64:
		return int(t), true
	case uint16:
		return int(t), true
	case uint32:
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
