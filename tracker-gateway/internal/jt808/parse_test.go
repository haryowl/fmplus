package jt808

import (
	"encoding/binary"
	"encoding/hex"
	"math"
	"testing"
	"time"
)

// Golden 0x0200 location body (28 bytes): Jakarta south/east.
const goldenLocationHex = "" +
	"00000000" + // alarm
	"00000004" + // status: bit2 south latitude
	"005e9ac0" + // lat |6.2| * 1e6
	"065da380" + // lon 106.8 * 1e6
	"001e" + // altitude 30 m
	"0190" + // speed 40.0 (0.1 km/h units)
	"005a" + // direction 90
	"240601103000" // BCD time 2024-06-01 10:30:00

func TestParseLocation_Golden(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parseLocation failed")
	}
	if math.Abs(fix.Lat-(-6.2)) > 1e-5 {
		t.Errorf("lat=%v want ~-6.2", fix.Lat)
	}
	if math.Abs(fix.Lon-106.8) > 1e-5 {
		t.Errorf("lon=%v want ~106.8", fix.Lon)
	}
	if fix.Speed == nil || math.Abs(*fix.Speed-40) > 0.01 {
		t.Errorf("speed=%v want 40", fix.Speed)
	}
	if fix.Heading == nil || *fix.Heading != 90 {
		t.Errorf("heading=%v want 90", fix.Heading)
	}
	want := time.Date(2024, 6, 1, 10, 30, 0, 0, time.UTC)
	if !fix.RecordedAt.Equal(want) {
		t.Errorf("recordedAt=%v want %v", fix.RecordedAt, want)
	}
	if fix.Ignition == nil || *fix.Ignition {
		t.Errorf("ignition=%v want false", fix.Ignition)
	}
	if fix.RawAttrs["status.acc"] != false {
		t.Errorf("status.acc=%v want false", fix.RawAttrs["status.acc"])
	}
}

func TestParseLocation_AlarmBitsFlattened(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	binary.BigEndian.PutUint32(body[0:4], 1<<0) // SOS
	binary.BigEndian.PutUint32(body[4:8], 0x01)  // ACC on
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["alarm.sos"] != true {
		t.Fatalf("expected alarm.sos on fix raw_attrs: %v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.acc"] != true {
		t.Fatalf("expected status.acc: %v", fix.RawAttrs)
	}
	if fix.Ignition == nil || !*fix.Ignition {
		t.Fatal("expected ignition true")
	}
}

func TestParseLocation_WestNorth(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	binary.BigEndian.PutUint32(body[4:8], 0x08)
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.Lat <= 0 {
		t.Errorf("lat=%v want positive (north)", fix.Lat)
	}
	if fix.Lon >= 0 {
		t.Errorf("lon=%v want negative (west)", fix.Lon)
	}
}

func TestParseLocation_StatusBitsOilDoor(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	// bit10 oil_cut + bit11 circuit_cut + bit13 door1
	binary.BigEndian.PutUint32(body[4:8], 0x0400|0x0800|0x2000)
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.oil_cut"] != true || fix.RawAttrs["status.circuit_cut"] != true {
		t.Fatalf("cut bits: %v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.door1"] != true || fix.RawAttrs["status.door"] != true {
		t.Fatalf("door: %v", fix.RawAttrs)
	}
}

func TestParseLocation_StatusBitsDoor345(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	binary.BigEndian.PutUint32(body[4:8], 0x8000|0x10000|0x20000)
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.door3"] != true || fix.RawAttrs["status.door4"] != true ||
		fix.RawAttrs["status.door5"] != true || fix.RawAttrs["status.door"] != true {
		t.Fatalf("door345: %v", fix.RawAttrs)
	}
}

func TestParseLocation_StatusBitsGNSSConstellation(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	// bit18 GPS + bit19 Beidou
	binary.BigEndian.PutUint32(body[4:8], 0x40000|0x80000)
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.gnss_gps"] != true || fix.RawAttrs["status.gnss_beidou"] != true {
		t.Fatalf("%v", fix.RawAttrs)
	}
}

func TestParseLocation_StatusBitsGPS(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	binary.BigEndian.PutUint32(body[4:8], 0x02) // bit1 GPS positioned
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.gps"] != true {
		t.Fatalf("gps=%v", fix.RawAttrs)
	}
}

func TestParseLocation_StatusBitsLoadFull(t *testing.T) {
	body := mustHex(t, goldenLocationHex)
	binary.BigEndian.PutUint32(body[4:8], 0x0300) // bits 8–9 full
	fix, ok := parseLocation(body)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["vehicle.load"] != "full" || fix.RawAttrs["status.load_full"] != true {
		t.Fatalf("%v", fix.RawAttrs)
	}
}

func TestParseLocation_TooShort(t *testing.T) {
	_, ok := parseLocation([]byte{1, 2, 3})
	if ok {
		t.Fatal("expected false for short body")
	}
}

func TestParseBcdTime(t *testing.T) {
	b := mustHex(t, "240601103000")
	got := parseBcdTime(b)
	want := time.Date(2024, 6, 1, 10, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
