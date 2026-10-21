package store

import (
	"context"
	"encoding/json"
	"time"
)

func (s *Store) loadLastFixSnap(ctx context.Context, deviceID string) lastFixSnap {
	var snap lastFixSnap
	var raw, mapped []byte
	err := s.pool.QueryRow(ctx, `
		SELECT lat, lon, recorded_at, ignition, COALESCE(raw_attrs, '{}'::jsonb), COALESCE(mapped_attrs, '{}'::jsonb)
		FROM vehicle_last_fix WHERE device_id = $1::uuid`, deviceID).Scan(
		&snap.Lat, &snap.Lon, &snap.RecordedAt, &snap.Ignition, &raw, &mapped,
	)
	if err != nil {
		return snap
	}
	snap.Has = true
	_ = json.Unmarshal(raw, &snap.Raw)
	_ = json.Unmarshal(mapped, &snap.Mapped)
	if snap.Raw == nil {
		snap.Raw = map[string]any{}
	}
	if snap.Mapped == nil {
		snap.Mapped = map[string]any{}
	}
	return snap
}

func asBoolAny(v any) (bool, bool) {
	switch t := v.(type) {
	case bool:
		return t, true
	case int:
		return t != 0, true
	case int64:
		return t != 0, true
	case float64:
		return t != 0, true
	case string:
		if t == "true" || t == "1" {
			return true, true
		}
		if t == "false" || t == "0" {
			return false, true
		}
	}
	return false, false
}

func attrBool(attrs map[string]any, keys ...string) (bool, bool) {
	if attrs == nil {
		return false, false
	}
	for _, k := range keys {
		if v, ok := attrs[k]; ok {
			if b, ok2 := asBoolAny(v); ok2 {
				return b, true
			}
		}
	}
	return false, false
}

type emitOn string

const (
	emitChange  emitOn = "change"
	emitRising  emitOn = "rising"
	emitFalling emitOn = "falling"
	emitEvent   emitOn = "event"
	emitNone    emitOn = "none"
)

func (s *Store) loadEmitOn(ctx context.Context, device *Device, alarmType string) emitOn {
	if device == nil {
		return emitChange
	}
	var on string
	err := s.pool.QueryRow(ctx, `
		SELECT emit_on FROM (
			SELECT 1 AS pri, emit_on FROM tracker_event_class_maps
			 WHERE device_id = $1::uuid AND alarm_type = $4
			UNION ALL
			SELECT 2, emit_on FROM tracker_event_class_maps
			 WHERE profile_id = $2::uuid AND device_id IS NULL AND alarm_type = $4
			UNION ALL
			SELECT 3, emit_on FROM tracker_event_class_maps
			 WHERE tenant_id = $3::uuid AND profile_id IS NULL AND device_id IS NULL AND alarm_type = $4
			UNION ALL
			SELECT 4, emit_on FROM tracker_event_type_defs WHERE alarm_type = $4
		) x ORDER BY pri LIMIT 1`,
		device.ID, nullableUUID(device.ProfileID), device.TenantID, alarmType,
	).Scan(&on)
	if err != nil || on == "" {
		if alarmType == "ignition" || alarmType == "movement" {
			return emitChange
		}
		return emitEvent
	}
	switch emitOn(on) {
	case emitChange, emitRising, emitFalling, emitEvent, emitNone:
		return emitOn(on)
	default:
		return emitEvent
	}
}

func nullableUUID(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

func shouldEmitEdge(on emitOn, prev, next bool, prevOK, nextOK bool) bool {
	if !nextOK || !prevOK || prev == next {
		return false
	}
	switch on {
	case emitChange:
		return true
	case emitRising:
		return !prev && next
	case emitFalling:
		return prev && !next
	default:
		return false
	}
}

func (s *Store) emitParamEdges(ctx context.Context, device *Device, prev lastFixSnap, fix Fix) {
	if device == nil {
		return
	}
	nextIgn, nextIgnOK := boolPtr(fix.Ignition)
	if !nextIgnOK {
		nextIgn, nextIgnOK = attrBool(fix.MappedAttrs, "ignition")
	}
	if !nextIgnOK {
		nextIgn, nextIgnOK = attrBool(fix.RawAttrs, "ignition", "status.ignition")
	}
	prevIgn, prevIgnOK := boolPtr(prev.Ignition)
	if !prevIgnOK {
		prevIgn, prevIgnOK = attrBool(prev.Mapped, "ignition")
	}
	if !prevIgnOK {
		prevIgn, prevIgnOK = attrBool(prev.Raw, "ignition", "status.ignition")
	}

	nextMove, nextMoveOK := attrBool(fix.MappedAttrs, "movement", "status.moving")
	if !nextMoveOK {
		nextMove, nextMoveOK = attrBool(fix.RawAttrs, "movement", "status.moving")
	}
	prevMove, prevMoveOK := attrBool(prev.Mapped, "movement", "status.moving")
	if !prevMoveOK {
		prevMove, prevMoveOK = attrBool(prev.Raw, "movement", "status.moving")
	}

	try := func(alarmType string, prevB, nextB bool, prevOK, nextOK bool) {
		on := s.loadEmitOn(ctx, device, alarmType)
		if !shouldEmitEdge(on, prevB, nextB, prevOK, nextOK) {
			return
		}
		lat, lon := fix.Lat, fix.Lon
		_ = s.InsertSafetyEvent(ctx, device, SafetyEvent{
			RecordedAt:     fix.RecordedAt,
			AlarmType:      alarmType,
			AlarmLevel:     0,
			Lat:            &lat,
			Lon:            &lon,
			SourceProtocol: fix.SourceProtocol,
			RawAttrs:       map[string]any{alarmType: nextB, "emit_on": string(on)},
		})
	}

	if prev.Has {
		try("ignition", prevIgn, nextIgn, prevIgnOK, nextIgnOK)
		try("movement", prevMove, nextMove, prevMoveOK, nextMoveOK)
	}
}

func boolPtr(v *bool) (bool, bool) {
	if v == nil {
		return false, false
	}
	return *v, true
}

type lastFixSnap struct {
	Has        bool
	Lat        float64
	Lon        float64
	RecordedAt time.Time
	Ignition   *bool
	Raw        map[string]any
	Mapped     map[string]any
}
