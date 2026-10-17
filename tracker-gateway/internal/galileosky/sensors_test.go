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

func TestPromoteSensorTags_Counters(t *testing.T) {
	raw := map[string]any{}
	c := make([]byte, 4)
	binary.LittleEndian.PutUint32(c, 42)
	promoteSensorTags(raw, map[byte][]byte{0xd5: c})
	if raw["counter.1"] != float64(42) {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_HWFW(t *testing.T) {
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0x01: {0x0a}, 0x02: {0x1b}})
	if raw["device.hw"] != 10 || raw["device.fw"] != 27 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_Temp(t *testing.T) {
	raw := map[string]any{}
	t1 := make([]byte, 2)
	binary.LittleEndian.PutUint16(t1, uint16(int16(253))) // 25.3 °C
	promoteSensorTags(raw, map[byte][]byte{0x70: t1})
	if raw["temp.1"] != 25.3 {
		t.Fatalf("%v", raw)
	}
}
