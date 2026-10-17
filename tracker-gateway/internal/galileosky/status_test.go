package galileosky

import "testing"

func TestApplyStatusTags_SOS(t *testing.T) {
	raw := map[string]any{}
	tags := map[byte][]byte{0x40: {0x01}, 0x41: {0x00}}
	ev := applyStatusTags(tags, raw)
	if ev == nil || ev.AlarmType != "sos" {
		t.Fatalf("ev=%+v", ev)
	}
	if raw["alarm.sos"] != true || raw["tag.0x40"] != 1 {
		t.Fatalf("raw=%v", raw)
	}
}

func TestApplyStatusTags_NoSOS(t *testing.T) {
	raw := map[string]any{}
	if applyStatusTags(map[byte][]byte{0x40: {0x02}}, raw) != nil {
		t.Fatal("expected nil")
	}
	if raw["tag.0x40"] != 2 {
		t.Fatalf("raw=%v", raw)
	}
}
