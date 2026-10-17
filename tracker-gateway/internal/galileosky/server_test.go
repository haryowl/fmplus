package galileosky

import "testing"

func TestApplyPacketMeta_ArchiveAndCount(t *testing.T) {
	raw := map[string]any{}
	applyPacketMeta(raw, true, 1)
	if raw["archive"] != true || raw["record_count"] != nil {
		t.Fatalf("archive only=%v", raw)
	}
	raw2 := map[string]any{}
	applyPacketMeta(raw2, false, 3)
	if raw2["archive"] != nil || raw2["record_count"] != 3 {
		t.Fatalf("count only=%v", raw2)
	}
	raw3 := map[string]any{}
	applyPacketMeta(raw3, true, 2)
	if raw3["archive"] != true || raw3["record_count"] != 2 {
		t.Fatalf("both=%v", raw3)
	}
	applyPacketMeta(nil, true, 2) // no panic
}
