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
	reg7 := make([]byte, 4)
	reg8 := make([]byte, 4)
	binary.LittleEndian.PutUint32(reg7, 77)
	binary.LittleEndian.PutUint32(reg8, 88)
	promoteSensorTags(raw, map[byte][]byte{0x86: reg7, 0x87: reg8})
	if raw["modbus.7"] != float64(77) || raw["modbus.8"] != float64(88) {
		t.Fatalf("modbus7/8=%v", raw)
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

func TestPromoteSensorTags_Sensor76_7a(t *testing.T) {
	raw := map[string]any{}
	a := make([]byte, 2)
	b := make([]byte, 2)
	c := make([]byte, 2)
	d := make([]byte, 2)
	binary.LittleEndian.PutUint16(a, 110)
	binary.LittleEndian.PutUint16(b, 120)
	binary.LittleEndian.PutUint16(c, 130)
	binary.LittleEndian.PutUint16(d, 140)
	promoteSensorTags(raw, map[byte][]byte{0x76: a, 0x77: b, 0x7a: c, 0x7b: d})
	if raw["sensor.7"] != 11.0 || raw["sensor.8"] != 12.0 ||
		raw["sensor.11"] != 13.0 || raw["sensor.12"] != 14.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_User15(t *testing.T) {
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0x15: {7}, 0x19: {9}})
	if raw["user.4"] != 7 || raw["user.8"] != 9 {
		t.Fatalf("%v", raw)
	}
	promoteSensorTags(raw, map[byte][]byte{0x12: {1}, 0x13: {2}, 0x14: {3}})
	if raw["user.1"] != 1 || raw["user.2"] != 2 || raw["user.3"] != 3 {
		t.Fatalf("user123=%v", raw)
	}
}

func TestPromoteSensorTags_CanC0(t *testing.T) {
	raw := map[string]any{}
	reg := make([]byte, 4)
	binary.LittleEndian.PutUint32(reg, 77)
	promoteSensorTags(raw, map[byte][]byte{0xc0: reg})
	if raw["can.5"] != float64(77) {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_AnalogA0(t *testing.T) {
	raw := map[string]any{}
	reg := make([]byte, 4)
	binary.LittleEndian.PutUint32(reg, 1500)
	promoteSensorTags(raw, map[byte][]byte{0xa0: reg})
	if raw["analog.10"] != float64(1500) {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_AnalogA2A3(t *testing.T) {
	raw := map[string]any{}
	a := make([]byte, 4)
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(a, 1200)
	binary.LittleEndian.PutUint32(b, 1300)
	promoteSensorTags(raw, map[byte][]byte{0xa2: a, 0xa3: b})
	if raw["analog.12"] != float64(1200) || raw["analog.13"] != float64(1300) {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteSensorTags_ExtUserCanAnalogAux(t *testing.T) {
	raw := map[string]any{}
	u21 := make([]byte, 4)
	c68 := make([]byte, 4)
	cC4 := make([]byte, 4)
	aA4 := make([]byte, 4)
	binary.LittleEndian.PutUint32(u21, 91)
	binary.LittleEndian.PutUint32(c68, 68)
	binary.LittleEndian.PutUint32(cC4, 196)
	binary.LittleEndian.PutUint32(aA4, 1400)
	aux1 := make([]byte, 2)
	aux2 := make([]byte, 2)
	binary.LittleEndian.PutUint16(aux1, 31)
	binary.LittleEndian.PutUint16(aux2, 32)
	promoteSensorTags(raw, map[byte][]byte{
		0x21: u21, 0x68: c68, 0xc4: cC4, 0xa4: aA4, 0x31: aux1, 0x32: aux2,
	})
	if raw["user.9"] != float64(91) || raw["can.9"] != float64(68) {
		t.Fatalf("user/can=%v", raw)
	}
	if raw["can.17"] != float64(196) || raw["analog.14"] != float64(1400) {
		t.Fatalf("can17/analog14=%v", raw)
	}
	if raw["gnss.aux1"] != float64(31) || raw["gnss.aux2"] != float64(32) {
		t.Fatalf("aux=%v", raw)
	}
}

func TestPromoteSensorTags_CmdReply(t *testing.T) {
	raw := map[string]any{}
	promoteSensorTags(raw, map[byte][]byte{0xe1: []byte("OK SET")})
	if raw["cmd.reply"] != "OK SET" || raw["cmd.reply_tag"] != "0xe1" {
		t.Fatalf("%v", raw)
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

func TestPromoteSensorTags_IButtonAndAccel(t *testing.T) {
	raw := map[string]any{}
	key := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08}
	accel := make([]byte, 6)
	binary.LittleEndian.PutUint16(accel[0:2], 0xff9c) // -100
	binary.LittleEndian.PutUint16(accel[2:4], 200)
	binary.LittleEndian.PutUint16(accel[4:6], 980)
	promoteSensorTags(raw, map[byte][]byte{0x48: key, 0x5a: accel})
	if raw["ibutton.id"] != "0102030405060708" {
		t.Fatalf("ibutton=%v", raw["ibutton.id"])
	}
	if raw["accel.x"] != float64(-100) || raw["accel.y"] != float64(200) || raw["accel.z"] != float64(980) {
		t.Fatalf("accel=%v", raw)
	}
	if tagSize(0x48) != 8 || tagSize(0x5a) != 6 {
		t.Fatalf("tagSize 0x48=%d 0x5a=%d", tagSize(0x48), tagSize(0x5a))
	}
}
