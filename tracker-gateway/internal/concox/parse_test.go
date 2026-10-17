package concox

import (
	"encoding/binary"
	"encoding/hex"
	"math"
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
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

func TestParseGPS_Proto22(t *testing.T) {
	// Same GPS body layout as 0x12 for the fields we decode.
	info := mustHex(t, goldenGPSInfoHex)
	fix, ok := parseGPS(info, 0x22)
	if !ok {
		t.Fatal("parseGPS 0x22 failed")
	}
	if fix.RawAttrs["proto"] != byte(0x22) && fix.RawAttrs["proto"] != 0x22 {
		// proto stored as byte in map
		if p, ok := fix.RawAttrs["proto"].(byte); !ok || p != 0x22 {
			t.Fatalf("proto=%v", fix.RawAttrs["proto"])
		}
	}
	if math.Abs(fix.Lon-106.8) > 1e-4 {
		t.Fatalf("lon=%v", fix.Lon)
	}
}

func TestDecodeInfo94_VoltageAndICCID(t *testing.T) {
	volt := decodeInfo94([]byte{0x00, 0x04, 0xb4}) // 1204 * 0.01 = 12.04 V
	if v, ok := volt["ext_voltage"].(float64); !ok || math.Abs(v-12.04) > 1e-6 {
		t.Fatalf("voltage=%v", volt["ext_voltage"])
	}
	iccid := decodeInfo94(append([]byte{0x0a}, []byte("89860012345678901234")...))
	if iccid["iccid"] != "89860012345678901234" {
		t.Fatalf("iccid=%v", iccid["iccid"])
	}
}

func TestParseLBS_Minimal(t *testing.T) {
	// mcc=510 mnc=10 lac=0x1234 cell=0x010203 rssi=20
	info := []byte{0x01, 0xfe, 0x0a, 0x12, 0x34, 0x01, 0x02, 0x03, 0x14}
	p := parseLBS(info)
	if p["mcc"] != 510 || p["mnc"] != 10 || p["lac"] != 0x1234 {
		t.Fatalf("lbs=%v", p)
	}
	if p["cell_id"] != 0x010203 || p["rssi"] != 20 {
		t.Fatalf("cell=%v", p)
	}
}

func TestCRC16ITU_KnownVector(t *testing.T) {
	// Empty → 0xFFFF init leaves 0xFFFF for empty input
	if crc16ITU(nil) != 0xFFFF {
		t.Fatalf("empty=%04x", crc16ITU(nil))
	}
	// Length+login-ish sample must be stable
	in := []byte{0x05, 0x01, 0x00, 0x01}
	sum := crc16ITU(in)
	if sum == 0 || sum == 0xFFFF {
		t.Fatalf("unexpected crc=%04x", sum)
	}
	// Round-trip: encode 0x80 frame and recompute CRC over length..serial
	frame, err := (Adapter{}).EncodeDownlink(store.Command{PayloadText: "DYD#"})
	if err != nil {
		t.Fatal(err)
	}
	if frame[0] != 0x78 || frame[3] != 0x80 {
		t.Fatalf("frame=%x", frame)
	}
	packetLen := int(frame[2]) // = bodyLen + 2 (CRC)
	bodyLen := packetLen - 2
	crcIn := frame[2 : 3+bodyLen] // length byte through serial
	want := binary.BigEndian.Uint16(frame[3+bodyLen : 5+bodyLen])
	if crc16ITU(crcIn) != want {
		t.Fatalf("frame crc got=%04x want=%04x in=%x", crc16ITU(crcIn), want, crcIn)
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
