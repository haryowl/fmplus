package jt809

import (
	"encoding/binary"
	"math"
	"testing"
)

func TestParseVehicleUplink_MinimalGNSS(t *testing.T) {
	rest := make([]byte, 24+1+6+8+4)
	copy(rest[0:21], []byte("B1234XYZ"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0 // encrypt
	off++
	off += 6 // datetime bcd placeholder
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 400) // 40.0 km/h * 10
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 90)

	fix, plate, ok := parseVehicleUplink(0x1200, rest)
	if !ok || plate != "B1234XYZ" {
		t.Fatalf("ok=%v plate=%q", ok, plate)
	}
	if math.Abs(fix.Lon-106.8) > 1e-3 || math.Abs(fix.Lat-(-6.2)) > 1e-3 {
		t.Fatalf("lat=%v lon=%v", fix.Lat, fix.Lon)
	}
	if fix.Speed == nil || *fix.Speed != 40 {
		t.Fatalf("speed=%v", fix.Speed)
	}
}

func TestParseVehicleUplink_Short(t *testing.T) {
	_, _, ok := parseVehicleUplink(0x1202, []byte{1, 2, 3})
	if ok {
		t.Fatal("expected false")
	}
}

func TestParseVehicleAlarm_SOS(t *testing.T) {
	rest := make([]byte, 24)
	copy(rest[0:21], []byte("B9999SOS"))
	rest[21] = 2
	binary.BigEndian.PutUint16(rest[22:24], 0x0001)
	plate, ev, ok := parseVehicleAlarm(0x1400, rest)
	if !ok || plate != "B9999SOS" || ev == nil || ev.AlarmType != "sos" {
		t.Fatalf("plate=%q ev=%+v ok=%v", plate, ev, ok)
	}
}
