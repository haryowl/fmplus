package galileosky

import (
	"encoding/binary"
	"testing"
)

func TestPromoteSensorTags_FuelAndAnalog(t *testing.T) {
	raw := map[string]any{}
	fuel := make([]byte, 2)
	binary.LittleEndian.PutUint16(fuel, 12345)
	ain := make([]byte, 2)
	binary.LittleEndian.PutUint16(ain, 12000) // 12.0 V
	promoteSensorTags(raw, map[byte][]byte{0x60: fuel, 0x52: ain})
	if raw["fuel.level"] != float64(12345) {
		t.Fatalf("%v", raw)
	}
	if raw["analog.2"] != 12.0 {
		t.Fatalf("analog=%v", raw["analog.2"])
	}
}

func TestPromoteSensorTags_Counters(t *testing.T) {
	raw := map[string]any{}
	c := make([]byte, 2)
	binary.LittleEndian.PutUint16(c, 42)
	promoteSensorTags(raw, map[byte][]byte{0xd6: c})
	if raw["can16.0"] != float64(42) || raw["axle.load1"] != float64(21) {
		t.Fatalf("%v", raw)
	}
	promoteSensorTags(raw, map[byte][]byte{0xd5: {0x05}})
	if raw["ibutton.mask"] != 5 {
		t.Fatalf("mask=%v", raw)
	}
}

func TestPromoteSensorTags_HWFW(t *testing.T) {
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0x01: {0x0a}, 0x02: {0x1b}})
	if raw["device.hw"] != 10 || raw["device.fw"] != 27 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_UnixTime(t *testing.T) {
	raw := map[string]any{}
	ts := make([]byte, 4)
	binary.LittleEndian.PutUint32(ts, 1700000000)
	promoteSensorTags(raw, map[byte][]byte{0x20: ts})
	if raw["unix_time"] != int64(1700000000) {
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

func TestPromoteSensorTags_TempOfficial(t *testing.T) {
	// Official: 01 10 → id 1, temp 16°C
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0x70: {0x01, 0x10}})
	if raw["temp.1"] != float64(16) || raw["temp.0.id"] != 1 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_RS485FuelTemp(t *testing.T) {
	raw := map[string]any{}
	// 0x63: fuel uint16 + temp int8
	promoteSensorTags(raw, map[byte][]byte{0x63: {0x64, 0x00, 0x16}})
	if raw["rs485.3.level"] != float64(100) || raw["fuel.temp"] != float64(22) {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_DS1923(t *testing.T) {
	// Formula: humidity = byte * 100 / 255. Byte 20 decimal → ≈7.84%.
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0x80: {0x01, 0x10, 20}})
	if raw["ds1923.0.temp"] != float64(16) {
		t.Fatalf("temp=%v", raw)
	}
	hum, _ := raw["ds1923.0.humidity"].(float64)
	if hum < 7.8 || hum > 7.9 {
		t.Fatalf("humidity=%v", hum)
	}
}

func TestPromoteSensorTags_CanC0AndCan8(t *testing.T) {
	raw := map[string]any{}
	reg := make([]byte, 4)
	binary.LittleEndian.PutUint32(reg, 77)
	promoteSensorTags(raw, map[byte][]byte{0xc0: reg, 0xc4: {0x09}, 0xa0: {0x0a}})
	if raw["can.0"] != float64(77) || raw["can.fuel_used"] != 38.5 {
		t.Fatalf("c0 cooked=%v", raw)
	}
	if raw["can8.0"] != 9 || raw["can8r.15"] != 10 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_CanC1OfficialExample(t *testing.T) {
	// Official PDF: FA 72 50 25 → fuel 100%, coolant 74°C, RPM 1194
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0xc1: {0xfa, 0x72, 0x50, 0x25}})
	if raw["can.fuel_level"] != 100.0 {
		t.Fatalf("fuel=%v", raw["can.fuel_level"])
	}
	if raw["can.coolant_temp"] != 74.0 {
		t.Fatalf("coolant=%v", raw["can.coolant_temp"])
	}
	if raw["can.rpm"] != 1194.0 {
		t.Fatalf("rpm=%v", raw["can.rpm"])
	}
}

func TestPromoteSensorTags_CmdReply(t *testing.T) {
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0xe1: []byte("OK SET")})
	if raw["cmd.reply"] != "OK SET" || raw["cmd.reply_tag"] != "0xe1" {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_UserDataAndModbus(t *testing.T) {
	raw := map[string]any{}
	u0 := make([]byte, 4)
	binary.LittleEndian.PutUint32(u0, 111)
	u7 := make([]byte, 4)
	binary.LittleEndian.PutUint32(u7, 222)
	cmd := make([]byte, 4)
	binary.LittleEndian.PutUint32(cmd, 9)
	// FE: modbus slot0 (ext 0x01)=55, modbus slot32 (ext 0x61)=66, gsm.cellid (0x81)=12345
	fe := []byte{
		0x01, 0x00, 0x37, 0x00, 0x00, 0x00,
		0x61, 0x00, 0x42, 0x00, 0x00, 0x00,
		0x81, 0x00, 0x39, 0x30, 0x00, 0x00,
	}
	promoteSensorTags(raw, map[byte][]byte{
		0xe0: cmd,
		0xe2: u0,
		0xe9: u7,
		0xea: {0xaa, 0xbb},
		0xfe: fe,
	})
	if raw["user.0"] != float64(111) || raw["user.7"] != float64(222) {
		t.Fatalf("user=%v", raw)
	}
	if raw["cmd.id"] != 9 {
		t.Fatalf("cmd.id=%v", raw["cmd.id"])
	}
	if raw["user.array_hex"] != "aabb" {
		t.Fatalf("array=%v", raw["user.array_hex"])
	}
	if raw["modbus.0"] != float64(55) || raw["modbus.32"] != float64(66) {
		t.Fatalf("modbus=%v", raw)
	}
	if raw["gsm.cellid"] != 12345 {
		t.Fatalf("gsm=%v", raw["gsm.cellid"])
	}
	// Bluetooth FE 0x21–0x60
	rawBle := map[string]any{}
	promoteSensorTags(rawBle, map[byte][]byte{
		0xfe: {
			0x21, 0x00, 0x0a, 0x00, 0x00, 0x00, // ble.0 = 10
			0x60, 0x00, 0x63, 0x00, 0x00, 0x00, // ble.63 = 99
		},
	})
	if rawBle["ble.0"] != float64(10) || rawBle["ble.63"] != float64(99) {
		t.Fatalf("ble=%v", rawBle)
	}
	// 0x80 is DS1923, not Modbus
	raw2 := map[string]any{}
	promoteSensorTags(raw2, map[byte][]byte{0x80: {0x01, 0x10, 20}})
	if raw2["modbus.1"] != nil || raw2["modbus.0"] != nil {
		t.Fatalf("DS1923 must not promote modbus: %v", raw2)
	}
}

func TestPromoteSensorTags_OdometerAndArchive(t *testing.T) {
	raw := map[string]any{}
	odo := make([]byte, 4)
	binary.LittleEndian.PutUint32(odo, 98765)
	arch := make([]byte, 2)
	binary.LittleEndian.PutUint16(arch, 42)
	promoteSensorTags(raw, map[byte][]byte{0xd4: odo, 0x10: arch})
	if raw["odometer"] != float64(98765) || raw["archive.record"] != 42 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_IButtonAndEnergy(t *testing.T) {
	raw := map[string]any{}
	key := []byte{0x01, 0x02, 0x03, 0x04}
	energy := make([]byte, 4)
	binary.LittleEndian.PutUint32(energy, 1234)
	promoteSensorTags(raw, map[byte][]byte{0x90: key, 0x5a: energy})
	if raw["ibutton.id"] != "01020304" {
		t.Fatalf("ibutton=%v", raw["ibutton.id"])
	}
	if raw["energy.rep500"] != float64(1234) {
		t.Fatalf("energy=%v", raw)
	}
	if tagSize(0x90) != 4 || tagSize(0x5a) != 4 {
		t.Fatalf("tagSize 0x90=%d 0x5a=%d", tagSize(0x90), tagSize(0x5a))
	}
}

func TestTagSize_UnknownOpaque(t *testing.T) {
	if tagSize(0x48) != 2 {
		t.Fatalf("0x48 extended status size=%d", tagSize(0x48))
	}
	if tagSize(0x78) != -1 || tagSize(0x5b) != -1 {
		t.Fatalf("unknown/opaque expected -1: 0x78=%d 0x5b=%d", tagSize(0x78), tagSize(0x5b))
	}
}
