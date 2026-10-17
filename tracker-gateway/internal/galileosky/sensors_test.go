package galileosky

import (
	"encoding/binary"
	"testing"
)

func TestPromoteSensorTags_FuelAndUser(t *testing.T) {
	raw := map[string]any{}
	fuel := make([]byte, 4)
	binary.LittleEndian.PutUint32(fuel, 12345)
	ain := make([]byte, 2)
	binary.LittleEndian.PutUint16(ain, 12000) // 12.0 V
	tags := map[byte][]byte{
		0x60: fuel,
		0x52: ain,
		0x11: {0x07},
	}
	promoteSensorTags(raw, tags)
	if raw["fuel.level"] != float64(12345) {
		t.Fatalf("%v", raw)
	}
	if raw["analog.2"] != 12.0 {
		t.Fatalf("analog=%v", raw["analog.2"])
	}
	if raw["user.0"] != 7 {
		t.Fatalf("user=%v", raw["user.0"])
	}
}
