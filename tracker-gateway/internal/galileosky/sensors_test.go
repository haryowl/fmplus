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

func TestPromoteSensorTags_IMEIAndID(t *testing.T) {
	raw := map[string]any{}
	id := make([]byte, 2)
	binary.LittleEndian.PutUint16(id, 99)
	promoteSensorTags(raw, map[byte][]byte{
		0x03: []byte("861234567890123"),
		0x04: id,
	})
	if raw["device.imei"] != "861234567890123" || raw["device.id"] != 99 {
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

func TestPromoteSensorTags_CANAndSensor(t *testing.T) {
	raw := map[string]any{}
	can := make([]byte, 4)
	binary.LittleEndian.PutUint32(can, 99)
	s := make([]byte, 2)
	binary.LittleEndian.PutUint16(s, 455) // 45.5
	promoteSensorTags(raw, map[byte][]byte{0x64: can, 0x74: s})
	if raw["can.1"] != float64(99) || raw["sensor.5"] != 45.5 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_Modbus(t *testing.T) {
	raw := map[string]any{}
	reg := make([]byte, 8)
	binary.LittleEndian.PutUint32(reg[0:4], 42)
	binary.LittleEndian.PutUint32(reg[4:8], 7)
	promoteSensorTags(raw, map[byte][]byte{0x80: reg})
	if raw["modbus.1"] != float64(42) || raw["modbus.1_hi"] != float64(7) {
		t.Fatalf("%v", raw)
	}
	reg5 := make([]byte, 4)
	binary.LittleEndian.PutUint32(reg5, 55)
	promoteSensorTags(raw, map[byte][]byte{0x84: reg5})
	if raw["modbus.5"] != float64(55) {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_Sensor78(t *testing.T) {
	raw := map[string]any{}
	s := make([]byte, 2)
	binary.LittleEndian.PutUint16(s, 123)
	promoteSensorTags(raw, map[byte][]byte{0x78: s})
	if raw["sensor.9"] != 12.3 {
		t.Fatalf("%v", raw)
	}
}
