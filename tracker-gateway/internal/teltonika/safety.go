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
	248: {"autogeofence", 1, "alarm.autogeofence"},
	249: {"jamming", 2, "alarm.jamming"},
	250: {"trip", 1, "alarm.trip"},
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

// highSignalIO is the subset of AVL IDs that raise safety when present as IO values
// even when event_io is 0 (periodic records).
var highSignalIO = []int{247, 246, 249, 252, 255, 253, 248, 175, 251, 240, 1, 9} // crash, towing, jamming, unplug, overspeed, green, autogeofence, geofence, idling, movement, sos

// flattenIOAlarms promotes known high-signal IO element values onto alarm.* keys.
func flattenIOAlarms(raw map[string]any, io map[string]any) {
	if raw == nil || io == nil {
		return
	}
	for id, k := range knownEventIO {
		v, ok := io[fmt.Sprintf("%d", id)]
		if !ok || !asIOTruth(v) {
			continue
		}
		raw[k.key] = true
		if cur, _ := raw["alarm_level"].(int); k.level > cur {
			raw["alarm_level"] = k.level
		} else if raw["alarm_level"] == nil {
			raw["alarm_level"] = k.level
		}
	}
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

// safetyFromIO raises a safety event from IO element values when event_io is unset/zero.
func safetyFromIO(fix store.Fix) *store.SafetyEvent {
	if fix.RawAttrs == nil {
		return nil
	}
	if eid, ok := asEventID(fix.RawAttrs["event_io"]); ok && eid != 0 {
		return nil // event_io path owns the event
	}
	io, _ := fix.RawAttrs["io"].(map[string]any)
	if io == nil {
		return nil
	}
	for _, id := range highSignalIO {
		v, ok := io[fmt.Sprintf("%d", id)]
		if !ok || !asIOTruth(v) {
			continue
		}
		k, ok := knownEventIO[id]
		if !ok {
			continue
		}
		lat, lon := fix.Lat, fix.Lon
		return &store.SafetyEvent{
			RecordedAt: fix.RecordedAt,
			AlarmType:  k.name,
			AlarmLevel: k.level,
			Lat:        &lat,
			Lon:        &lon,
			RawAttrs: map[string]any{
				"io_id":       id,
				"alarm_level": k.level,
				k.key:         true,
			},
			SourceProtocol: "teltonika",
		}
	}
	return nil
}

func asIOTruth(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int:
		return t != 0
	case int64:
		return t != 0
	case float64:
		return t != 0
	case string:
		return t != "" && t != "0" && t != "false"
	}
	return false
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
