package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
)

type RemapRule struct {
	VendorKey    string
	AppParamID   string
	Transform    string
	TransformArg map[string]any
}

// LoadRemapRules returns device-level rules first, then profile rules (device wins on same vendor_key).
func (s *Store) LoadRemapRules(ctx context.Context, deviceID string, profileID *string) ([]RemapRule, error) {
	seen := map[string]bool{}
	var out []RemapRule

	appendQuery := func(q string, arg any) {
		rows, err := s.pool.Query(ctx, q, arg)
		if err != nil {
			return
		}
		defer rows.Close()
		for rows.Next() {
			var r RemapRule
			var argRaw []byte
			if err := rows.Scan(&r.VendorKey, &r.AppParamID, &r.Transform, &argRaw); err != nil {
				continue
			}
			if seen[r.VendorKey] {
				continue
			}
			seen[r.VendorKey] = true
			_ = json.Unmarshal(argRaw, &r.TransformArg)
			if r.TransformArg == nil {
				r.TransformArg = map[string]any{}
			}
			out = append(out, r)
		}
	}

	appendQuery(`
		SELECT vendor_key, app_param_id, transform, transform_arg
		FROM tracker_param_maps
		WHERE device_id = $1::uuid AND enabled = true`, deviceID)

	if profileID != nil && *profileID != "" {
		appendQuery(`
			SELECT vendor_key, app_param_id, transform, transform_arg
			FROM tracker_param_maps
			WHERE profile_id = $1::uuid AND enabled = true`, *profileID)
	}
	return out, nil
}

func ApplyRemap(raw map[string]any, rules []RemapRule) map[string]any {
	mapped := map[string]any{}
	if raw == nil {
		return mapped
	}
	for _, rule := range rules {
		val, ok := lookupRaw(raw, rule.VendorKey)
		if !ok {
			continue
		}
		mapped[rule.AppParamID] = transformValue(val, rule.Transform, rule.TransformArg)
	}
	return mapped
}

func lookupRaw(raw map[string]any, key string) (any, bool) {
	if v, ok := raw[key]; ok {
		return v, true
	}
	if io, ok := raw["io"].(map[string]any); ok {
		if len(key) > 3 && key[:3] == "io." {
			if v, ok := io[key[3:]]; ok {
				return v, true
			}
		}
	}
	if tags, ok := raw["tags"].(map[string]any); ok {
		if len(key) > 4 && key[:4] == "tag." {
			if v, ok := tags[key[4:]]; ok {
				return v, true
			}
		}
	}
	if add, ok := raw["add"].(map[string]any); ok {
		if len(key) > 4 && key[:4] == "add." {
			if v, ok := add[key[4:]]; ok {
				return v, true
			}
		}
	}
	return nil, false
}

func transformValue(v any, transform string, arg map[string]any) any {
	switch transform {
	case "invert_bool":
		return !asBool(v)
	case "scale":
		scale := asFloat(arg["scale"])
		if scale == 0 {
			scale = 1
		}
		return asFloat(v) * scale
	case "offset":
		return asFloat(v) + asFloat(arg["offset"])
	case "bit_mask":
		mask := int64(asFloat(arg["mask"]))
		if mask == 0 {
			mask = 1
		}
		return (int64(asFloat(v)) & mask) != 0
	case "enum_map":
		if m, ok := arg["map"].(map[string]any); ok {
			k := fmt.Sprint(v)
			if out, ok := m[k]; ok {
				return out
			}
		}
		return v
	default:
		return v
	}
}

func asFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(t, 64)
		return f
	case bool:
		if t {
			return 1
		}
		return 0
	default:
		return 0
	}
}

func asBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	default:
		return asFloat(v) != 0
	}
}

// ApplyMappedToTyped copies well-known mapped params onto Fix typed fields.
func ApplyMappedToTyped(fix *Fix, mapped map[string]any) {
	if fix == nil || mapped == nil {
		return
	}
	if v, ok := mapped["ignition"]; ok {
		b := asBool(v)
		fix.Ignition = &b
	}
	if v, ok := mapped["odometer_km"]; ok {
		f := asFloat(v)
		fix.Odometer = &f
	}
	if v, ok := mapped["speed_kmh"]; ok {
		f := asFloat(v)
		fix.Speed = &f
	}
	if v, ok := mapped["heading_deg"]; ok {
		f := asFloat(v)
		fix.Heading = &f
	}
	if v, ok := mapped["satellites"]; ok {
		n := int(asFloat(v))
		fix.Satellites = &n
	}
}
