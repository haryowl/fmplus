package concox

import (
	"encoding/binary"
	"encoding/hex"
	"math"
	"testing"
	"time"
)

// Golden GT06-style GPS info for proto 0x12 (no frame header).
const goldenGPSInfoHex = "" +
	"1806010a1e00" + // datetime bytes (year+2000 style, not BCD)
	"0c" + // gps info length
	"0c" + // sats in low nibble = 12
	"00aa49c0" + // lat 6.2 * 1800000
	"0b755980" + // lon 106.8 * 1800000
	"28" + // speed 40
	"005a" // course 90, south/east

func TestParseGPS_Golden12(t *testing.T) {
	info := mustHex(t, goldenGPSInfoHex)
	fix, ok := parseGPS(info, 0x12)
	if !ok {
		t.Fatal("parseGPS failed")
	}
	if math.Abs(fix.Lat-(-6.2)) > 1e-4 {
		t.Errorf("lat=%v want ~-6.2", fix.Lat)
	}
	if math.Abs(fix.Lon-106.8) > 1e-4 {
		t.Errorf("lon=%v want ~106.8", fix.Lon)
	}
	if fix.Speed == nil || *fix.Speed != 40 {
		t.Errorf("speed=%v want 40", fix.Speed)
	}
	if fix.Heading == nil || *fix.Heading != 90 {
		t.Errorf("heading=%v want 90", fix.Heading)
	}
	if fix.Satellites == nil || *fix.Satellites != 12 {
		t.Errorf("sats=%v want 12", fix.Satellites)
	}
	want := time.Date(2024, 6, 1, 10, 30, 0, 0, time.UTC)
	if !fix.RecordedAt.Equal(want) {
		t.Errorf("recordedAt=%v want %v", fix.RecordedAt, want)
	}
}

func TestParseGPS_NorthWest(t *testing.T) {
	info := mustHex(t, goldenGPSInfoHex)
	binary.BigEndian.PutUint16(info[len(info)-2:], 0x0c5a)
	fix, ok := parseGPS(info, 0x12)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.Lat <= 0 {
		t.Errorf("lat=%v want north (+)", fix.Lat)
	}
	if fix.Lon >= 0 {
		t.Errorf("lon=%v want west (-)", fix.Lon)
	}
}

func TestBcdIMEI(t *testing.T) {
	raw := mustHex(t, "0352094081234567")
	imei := bcdIMEI(raw)
	if imei != "352094081234567" {
		t.Fatalf("imei=%q", imei)
	}
}

func TestTakeFrame_Short78(t *testing.T) {
	// 78 78 | len=5 | proto+serial+crc (5) | 0D 0A
	frame := []byte{0x78, 0x78, 0x05, 0x13, 0x00, 0x01, 0x12, 0x34, 0x0d, 0x0a}
	got, rest, ok := takeFrame(frame)
	if !ok {
		t.Fatal("expected frame")
	}
	if len(rest) != 0 {
		t.Fatalf("rest=%x", rest)
	}
	if len(got) != len(frame) {
		t.Fatalf("got len=%d", len(got))
	}
}

func TestParseGPS_TooShort(t *testing.T) {
	_, ok := parseGPS([]byte{1, 2, 3}, 0x12)
	if ok {
		t.Fatal("expected false")
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
