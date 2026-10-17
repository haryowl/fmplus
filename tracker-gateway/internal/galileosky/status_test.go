package galileosky

import "testing"

func TestApplyStatusTags_SOS(t *testing.T) {
	raw := map[string]any{}
	tags := map[byte][]byte{0x40: {0x01}, 0x41: {0x00}}
	evs := applyStatusTags(tags, raw)
	if len(evs) != 1 || evs[0].AlarmType != "sos" {
		t.Fatalf("evs=%+v", evs)
	}
	if raw["alarm.sos"] != true || raw["tag.0x40"] != 1 {
		t.Fatalf("raw=%v", raw)
	}
}

func TestApplyStatusTags_Vibration(t *testing.T) {
	raw := map[string]any{}
	evs := applyStatusTags(map[byte][]byte{0x40: {0x02}}, raw)
	if len(evs) != 1 || evs[0].AlarmType != "vibration" {
		t.Fatalf("evs=%+v", evs)
	}
	if raw["tag.0x40"] != 2 || raw["alarm.vibration"] != true {
		t.Fatalf("raw=%v", raw)
	}
}

func TestApplyStatusTags_Ignition(t *testing.T) {
	raw := map[string]any{}
	if len(applyStatusTags(map[byte][]byte{0x41: {0x01}}, raw)) != 0 {
		t.Fatal("no safety for ignition-only")
	}
	if raw["status.acc"] != true {
		t.Fatalf("raw=%v", raw)
	}
}

func TestApplyStatusTags_OverspeedTowing(t *testing.T) {
	raw := map[string]any{}
	evs := applyStatusTags(map[byte][]byte{0x42: {0x01}, 0x43: {0x01}}, raw)
	if len(evs) != 2 {
		t.Fatalf("evs=%+v", evs)
	}
	types := map[string]bool{}
	for _, e := range evs {
		types[e.AlarmType] = true
	}
	if !types["overspeed"] || !types["towing"] {
		t.Fatalf("types=%v", types)
	}
}

func TestApplyStatusTags_BatteryJamming(t *testing.T) {
	raw := map[string]any{}
	evs := applyStatusTags(map[byte][]byte{0x44: {0x02}, 0x45: {0x01}}, raw)
	if len(evs) != 2 {
		t.Fatalf("evs=%+v", evs)
	}
	if raw["alarm.battery_low"] != true || raw["alarm.gsm_jamming"] != true {
		t.Fatalf("%v", raw)
	}
}
