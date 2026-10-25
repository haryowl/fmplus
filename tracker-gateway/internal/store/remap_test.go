package store

import "testing"

func TestApplyRemap_IONested(t *testing.T) {
	raw := map[string]any{
		"io": map[string]any{"239": 1, "16": 12345},
	}
	rules := []RemapRule{
		{VendorKey: "io.239", AppParamID: "ignition", Transform: "identity"},
		{VendorKey: "io.16", AppParamID: "odometer_km", Transform: "scale", TransformArg: map[string]any{"scale": 0.001}},
	}
	mapped := ApplyRemap(raw, rules)
	if mapped["ignition"] != 1 {
		t.Fatalf("ignition=%v", mapped["ignition"])
	}
	if mapped["odometer_km"] != 12.345 {
		t.Fatalf("odo=%v", mapped["odometer_km"])
	}
	fix := Fix{}
	ApplyMappedToTyped(&fix, mapped)
	if fix.Ignition == nil || !*fix.Ignition {
		t.Fatal("expected ignition true")
	}
}

func TestApplyRemap_Expr(t *testing.T) {
	raw := map[string]any{
		"io":  map[string]any{"239": 1.0, "16": 12345.0},
		"odo": 12345.0,
	}
	mapped := ApplyRemap(raw, []RemapRule{
		{VendorKey: "odo", AppParamID: "odometer_km", Transform: "expr", TransformArg: map[string]any{"expr": "io.239 == 1 ? value * 0.001 : 0"}},
	})
	got, _ := mapped["odometer_km"].(float64)
	if got < 12.3 || got > 12.4 {
		t.Fatalf("odo=%v", mapped["odometer_km"])
	}
}

func TestApplyRemap_InvertBool(t *testing.T) {
	raw := map[string]any{"flag": 0}
	mapped := ApplyRemap(raw, []RemapRule{
		{VendorKey: "flag", AppParamID: "sos", Transform: "invert_bool"},
	})
	if mapped["sos"] != true {
		t.Fatalf("sos=%v", mapped["sos"])
	}
}
