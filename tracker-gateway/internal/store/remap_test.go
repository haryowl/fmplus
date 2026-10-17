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

func TestApplyRemap_InvertBool(t *testing.T) {
	raw := map[string]any{"flag": 0}
	mapped := ApplyRemap(raw, []RemapRule{
		{VendorKey: "flag", AppParamID: "sos", Transform: "invert_bool"},
	})
	if mapped["sos"] != true {
		t.Fatalf("sos=%v", mapped["sos"])
	}
}
