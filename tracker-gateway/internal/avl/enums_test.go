package avl

import "testing"

func TestGreenDrivingType(t *testing.T) {
	name, label := RefineEvent("green_driving", 253, 2)
	if name != "harsh_brake" || label != "Harsh braking" {
		t.Fatalf("got %s %q", name, label)
	}
	name, label = RefineEvent("green_driving", 253, 99)
	if name != "green_driving" || label != "Green driving" {
		t.Fatalf("unknown=%s %q", name, label)
	}
}

func TestCrashLabelOfficial(t *testing.T) {
	if CrashLabel(1) == "" || CrashLabel(14) == "" || CrashLabel(7) != "" {
		t.Fatalf("crash labels 1=%q 14=%q 7=%q", CrashLabel(1), CrashLabel(14), CrashLabel(7))
	}
}

func TestPermanentIODescriptions(t *testing.T) {
	if PermanentLabel(80, 2) != "Roaming on stop" {
		t.Fatalf("data mode=%q", PermanentLabel(80, 2))
	}
	if PermanentLabel(200, 4) != "Ultra sleep" {
		t.Fatalf("sleep=%q", PermanentLabel(200, 4))
	}
	if PermanentLabel(69, 1) != "GNSS on with fix" {
		t.Fatalf("gnss=%q", PermanentLabel(69, 1))
	}
	if PermanentLabel(237, 99) != "Unknown" {
		t.Fatalf("network=%q", PermanentLabel(237, 99))
	}
	name, label := RefineEvent("ignition", 239, 0)
	if name != "ignition" || label != "Ignition off" {
		t.Fatalf("ignition=%s %q", name, label)
	}
	name, label = RefineEvent("movement", 240, 1)
	if name != "movement" || label != "Movement on" {
		t.Fatalf("movement=%s %q", name, label)
	}
}

func TestEnrichSafetyRaw(t *testing.T) {
	raw := map[string]any{}
	name := EnrichSafetyRaw(raw, "green_driving", 253, 3, true)
	if name != "harsh_corner" {
		t.Fatalf("name=%s", name)
	}
	if raw["io_label"] != "Harsh cornering" || raw["green_driving.value"] != 3 {
		t.Fatalf("raw=%v", raw)
	}
}
