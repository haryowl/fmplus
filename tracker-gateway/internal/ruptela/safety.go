package ruptela

import (
	"fmt"

	"github.com/haryowl/fmplus/tracker-gateway/internal/avl"
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

type knownEvent struct {
	name  string
	level int
	key   string
}

// Overlap with Teltonika AVL where Ruptela FM configs share IO numbering.
var knownEventIO = map[int]knownEvent{
	1:   {"sos", 2, "alarm.sos"},       // DIN1 / SOS on many FM configs
	2:   {"door", 1, "alarm.door"},     // DIN2 / door
	3:   {"door", 1, "alarm.door"},
	5:   {"ignition", 1, "alarm.ignition"},
	9:   {"sos", 2, "alarm.sos"},
	14:  {"door", 1, "alarm.door"},
	15:  {"door", 1, "alarm.door"},
	66:  {"ext_voltage", 1, "alarm.ext_voltage"},
	175: {"geofence", 1, "alarm.geofence"},
	236: {"alarm", 2, "alarm.generic"},
	239: {"ignition", 1, "alarm.ignition"},
	240: {"movement", 1, "alarm.movement"},
	243: {"green_driving", 1, "alarm.green_driving_duration"},
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
}

// highSignalIO raises safety from IO values when event_io is unset (periodic records).
var highSignalIO = []int{247, 246, 249, 252, 255, 253, 248, 175, 251, 240, 1, 9}

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
	val, has := lookupIOValue(fix.RawAttrs, eid)
	name := avl.EnrichSafetyRaw(raw, k.name, eid, val, has)
	return &store.SafetyEvent{
		RecordedAt:     fix.RecordedAt,
		AlarmType:      name,
		AlarmLevel:     k.level,
		Lat:            &lat,
		Lon:            &lon,
		RawAttrs:       raw,
		SourceProtocol: "ruptela",
	}
}

// safetyFromIO raises a safety event from IO values when event_io is unset/zero.
func safetyFromIO(fix store.Fix) *store.SafetyEvent {
	if fix.RawAttrs == nil {
		return nil
	}
	if eid, ok := asEventID(fix.RawAttrs["event_io"]); ok && eid != 0 {
		return nil
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
		raw := map[string]any{
			"io_id":       id,
			"alarm_level": k.level,
			k.key:         true,
		}
		val, has := lookupIOValue(fix.RawAttrs, id)
		name := avl.EnrichSafetyRaw(raw, k.name, id, val, has)
		return &store.SafetyEvent{
			RecordedAt:     fix.RecordedAt,
			AlarmType:      name,
			AlarmLevel:     k.level,
			Lat:            &lat,
			Lon:            &lon,
			RawAttrs:       raw,
			SourceProtocol: "ruptela",
		}
	}
	return nil
}

func lookupIOValue(raw map[string]any, id int) (int, bool) {
	if raw == nil {
		return 0, false
	}
	if io, ok := raw["io"].(map[string]any); ok {
		if v, ok := io[fmt.Sprintf("%d", id)]; ok {
			return ioInt(v), true
		}
	}
	switch id {
	case 253:
		if v, ok := raw["green_driving.value"]; ok {
			return ioInt(v), true
		}
	case 247:
		if v, ok := raw["crash.value"]; ok {
			return ioInt(v), true
		}
	case 239:
		if v, ok := raw["ignition.value"]; ok {
			return ioInt(v), true
		}
		if v, ok := raw["status.ignition"]; ok {
			return ioInt(v), true
		}
	case 240:
		if v, ok := raw["movement.value"]; ok {
			return ioInt(v), true
		}
		if v, ok := raw["status.movement"]; ok {
			return ioInt(v), true
		}
	}
	return 0, false
}

func ioInt(v any) int {
	switch t := v.(type) {
	case bool:
		if t {
			return 1
		}
		return 0
	case int:
		return t
	case int64:
		return int(t)
	case float64:
		return int(t)
	default:
		return int(asFloat64(v))
	}
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
