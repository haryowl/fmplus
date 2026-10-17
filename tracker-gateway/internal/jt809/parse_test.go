package jt809

import (
	"encoding/binary"
	"math"
	"testing"
	"time"
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
	if fix.RawAttrs["location_realtime"] != true {
		t.Fatalf("realtime=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["body_len"] != len(rest) {
		t.Fatalf("body_len=%v want=%d", fix.RawAttrs["body_len"], len(rest))
	}
	fixH, _, okH := parseVehicleUplink(0x1203, rest)
	if !okH || fixH.RawAttrs["location_history"] != true {
		t.Fatalf("history=%v", fixH.RawAttrs)
	}
	fixS, _, okS := parseVehicleUplink(0x1202, rest)
	if !okS || fixS.RawAttrs["location_supplement"] != true {
		t.Fatalf("supplement=%v", fixS.RawAttrs)
	}
}

func TestParseVehicleUplink_AltitudeState(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B5555ALT"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 100) // speed
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 45) // heading
	off += 2
	binary.BigEndian.PutUint16(rest[off:], uint16(int16(120))) // altitude
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0x01|0x02|0x0400) // ACC + GPS + oil_cut
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0x02) // alarm nonzero

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok || fix.Altitude == nil || *fix.Altitude != 120 {
		t.Fatalf("alt=%v ok=%v", fix.Altitude, ok)
	}
	if fix.RawAttrs["vehicle_state"] != int(0x01|0x02|0x0400) || fix.RawAttrs["status.acc"] != true {
		t.Fatalf("%v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.gps"] != true {
		t.Fatalf("status.gps missing: %v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.oil_cut"] != true {
		t.Fatalf("oil_cut missing: %v", fix.RawAttrs)
	}
	if fix.RawAttrs["alarm.gnss"] != true {
		t.Fatalf("alarm %v", fix.RawAttrs)
	}
	if fix.RawAttrs["encrypt"] != 0 {
		t.Fatalf("encrypt=%v", fix.RawAttrs["encrypt"])
	}
	if _, ok := fix.RawAttrs["gnss_time_bcd"].(string); !ok {
		t.Fatalf("gnss_time_bcd missing: %v", fix.RawAttrs)
	}
}

func TestParseVehicleUplink_EncryptAndTimeBCD(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B9999ENC"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 1 // encrypt
	off++
	bcd := []byte{0x26, 0x03, 0x17, 0x12, 0x30, 0x45}
	copy(rest[off:], bcd)
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0)
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0)

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["encrypt"] != 1 {
		t.Fatalf("encrypt=%v", fix.RawAttrs["encrypt"])
	}
	if fix.RawAttrs["gnss_time_bcd"] != "260317123045" {
		t.Fatalf("bcd=%v", fix.RawAttrs["gnss_time_bcd"])
	}
	if fix.RawAttrs["gnss_time"] != "2026-03-17T12:30:45Z" {
		t.Fatalf("gnss_time=%v", fix.RawAttrs["gnss_time"])
	}
	if fix.RecordedAt.IsZero() || fix.RecordedAt.UTC().Format(time.RFC3339) != "2026-03-17T12:30:45Z" {
		t.Fatalf("RecordedAt=%v", fix.RecordedAt)
	}
}

func TestParseVehicleUplink_Door1AndCircuit(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B2222DR1"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0x2000|0x0800) // door1 + circuit_cut
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0)

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.door1"] != true || fix.RawAttrs["status.circuit_cut"] != true {
		t.Fatalf("door1/circuit=%v", fix.RawAttrs)
	}
}

func TestParseVehicleUplink_Door345(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B3333DR5"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0x8000|0x10000|0x20000)
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0)

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.door3"] != true || fix.RawAttrs["status.door4"] != true ||
		fix.RawAttrs["status.door5"] != true || fix.RawAttrs["status.door"] != true {
		t.Fatalf("door345=%v", fix.RawAttrs)
	}
}

func TestParseVehicleUplink_Door2AndLock(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B6666DR2"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 100)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 45)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], uint16(int16(50)))
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0x4000|0x1000) // door2 + door_lock
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0)

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.door2"] != true || fix.RawAttrs["status.door_lock"] != true {
		t.Fatalf("door2/lock: %v", fix.RawAttrs)
	}
}

func TestParseVehicleUplink_GNSSAlarmBits(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B4444SOS"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0)
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 1) // SOS bit0

	fix, _, ok := parseVehicleUplink(0x1200, rest)
	if !ok || fix.RawAttrs["alarm.sos"] != true {
		t.Fatalf("%v ok=%v", fix.RawAttrs, ok)
	}
}

func TestParseVehicleUplink_LoadAndGNSSConstellation(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B7777LDG"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 50)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 90)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 10)
	off += 2
	// ACC + load full (bits 8–9) + GPS + Beidou
	binary.BigEndian.PutUint32(rest[off:], 0x01|(3<<8)|0x40000|0x80000)
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0)

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.acc"] != true || fix.RawAttrs["vehicle.load"] != "full" ||
		fix.RawAttrs["status.load_full"] != true {
		t.Fatalf("load=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.gnss_gps"] != true || fix.RawAttrs["status.gnss_beidou"] != true {
		t.Fatalf("gnss=%v", fix.RawAttrs)
	}
	if lat, ok := fix.RawAttrs["lat"].(float64); !ok || math.Abs(lat-(-6.2)) > 1e-6 {
		t.Fatalf("lat=%v", fix.RawAttrs["lat"])
	}
	if lon, ok := fix.RawAttrs["lon"].(float64); !ok || math.Abs(lon-106.8) > 1e-6 {
		t.Fatalf("lon=%v", fix.RawAttrs["lon"])
	}
}

func TestParseVehicleUplink_OutOfServiceLoadHalf(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B1111OOS"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0x10|(1<<8)|0x100000|0x200000) // OOS + half + GLONASS + Galileo
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0)

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.out_of_service"] != true || fix.RawAttrs["status.load_half"] != true {
		t.Fatalf("oos/half=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.gnss_glonass"] != true || fix.RawAttrs["status.gnss_galileo"] != true {
		t.Fatalf("gnss=%v", fix.RawAttrs)
	}
}

func TestParseVehicleUplink_IllegalIgnitionAlarm(t *testing.T) {
	rest := make([]byte, 24+1+6+8+2+2+2+4+4)
	copy(rest[0:21], []byte("B8888IGN"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0200)
	off := 24
	rest[off] = 0
	off++
	off += 6
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(106.8*1e6))))
	off += 4
	binary.BigEndian.PutUint32(rest[off:], uint32(int32(math.Round(-6.2*1e6))))
	off += 4
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint16(rest[off:], 0)
	off += 2
	binary.BigEndian.PutUint32(rest[off:], 0)
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 1<<28) // illegal_ignition

	fix, _, ok := parseVehicleUplink(0x1200, rest)
	if !ok || fix.RawAttrs["alarm.illegal_ignition"] != true {
		t.Fatalf("%v ok=%v", fix.RawAttrs, ok)
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

func TestParseVehicleAlarm_1401Attach(t *testing.T) {
	rest := make([]byte, 24)
	copy(rest[0:21], []byte("B8888ATT"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x0002)
	plate, ev, ok := parseVehicleAlarm(0x1401, rest)
	if !ok || plate != "B8888ATT" || ev == nil || ev.AlarmType != "overspeed" {
		t.Fatalf("plate=%q ev=%+v ok=%v", plate, ev, ok)
	}
	if ev.RawAttrs["proto_msg"] != "0x1401" {
		t.Fatalf("%v", ev.RawAttrs)
	}
}

func TestParseVehicleAlarm_RouteDeviation(t *testing.T) {
	rest := make([]byte, 24)
	copy(rest[0:21], []byte("B7777RTE"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 22)
	_, ev, ok := parseVehicleAlarm(0x1400, rest)
	if !ok || ev == nil || ev.AlarmType != "route_deviation" {
		t.Fatalf("%+v ok=%v", ev, ok)
	}
	if ev.RawAttrs["alarm.route_deviation"] != true {
		t.Fatalf("raw=%v", ev.RawAttrs)
	}
}

func TestParseVehicleAlarm_Collision(t *testing.T) {
	rest := make([]byte, 24)
	copy(rest[0:21], []byte("B6666COL"))
	rest[21] = 2
	binary.BigEndian.PutUint16(rest[22:24], 28)
	_, ev, ok := parseVehicleAlarm(0x1402, rest)
	if !ok || ev == nil || ev.AlarmType != "collision" || ev.AlarmLevel != 2 {
		t.Fatalf("%+v ok=%v", ev, ok)
	}
	if ev.RawAttrs["alarm.collision"] != true {
		t.Fatalf("raw=%v", ev.RawAttrs)
	}
}

func TestParseVehicleAlarm_WarnBodyAndGNSS(t *testing.T) {
	rest := make([]byte, 38+5+8)
	copy(rest[0:21], []byte("B5555WRN"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 1) // SOS
	// BCD 2026-10-17 12:30:00
	copy(rest[24:30], []byte{0x26, 0x10, 0x17, 0x12, 0x30, 0x00})
	binary.BigEndian.PutUint32(rest[30:34], 4242)
	binary.BigEndian.PutUint32(rest[34:38], 5)
	copy(rest[38:43], []byte("hello"))
	binary.BigEndian.PutUint32(rest[43:47], uint32(int32(math.Round(106.8*1e6))))
	binary.BigEndian.PutUint32(rest[47:51], uint32(int32(math.Round(-6.2*1e6))))
	_, ev, ok := parseVehicleAlarm(0x1400, rest)
	if !ok || ev == nil || ev.AlarmType != "sos" {
		t.Fatalf("%+v ok=%v", ev, ok)
	}
	if ev.RawAttrs["info_id"] != 4242 || ev.RawAttrs["info_content"] != "hello" {
		t.Fatalf("attrs=%v", ev.RawAttrs)
	}
	if ev.AttachmentID != "4242" {
		t.Fatalf("attach=%q", ev.AttachmentID)
	}
	if ev.Lat == nil || ev.Lon == nil || math.Abs(*ev.Lon-106.8) > 1e-3 || math.Abs(*ev.Lat-(-6.2)) > 1e-3 {
		t.Fatalf("lat=%v lon=%v", ev.Lat, ev.Lon)
	}
	if ev.RecordedAt.Year() != 2026 || ev.RecordedAt.Month() != 10 || ev.RecordedAt.Day() != 17 {
		t.Fatalf("time=%v", ev.RecordedAt)
	}
}

func TestParseMediaAttach1210_File(t *testing.T) {
	rest := make([]byte, 26+8)
	copy(rest[0:21], []byte("B4444MED"))
	rest[21] = 1
	binary.BigEndian.PutUint32(rest[22:26], 8)
	copy(rest[26:], []byte("clip.mp4"))
	plate, patch, ok := parseMediaAttach1210(rest)
	if !ok || plate != "B4444MED" || patch["attach_file"] != "clip.mp4" {
		t.Fatalf("plate=%q patch=%v ok=%v", plate, patch, ok)
	}
}

func TestParsePlatformLogin1001(t *testing.T) {
	rest := make([]byte, 46)
	binary.BigEndian.PutUint32(rest[0:4], 12345)
	copy(rest[4:12], []byte("secret"))
	copy(rest[12:44], []byte("10.0.0.5"))
	binary.BigEndian.PutUint16(rest[44:46], 8900)
	m := parsePlatformLogin1001(rest)
	if m["platform_user_id"] != 12345 || m["platform_key"] != "809-12345" {
		t.Fatalf("%v", m)
	}
	if m["downlink_ip"] != "10.0.0.5" || m["downlink_port"] != 8900 {
		t.Fatalf("%v", m)
	}
	if m["platform_password_set"] != true || m["platform_password_len"] != 6 {
		t.Fatalf("pass=%v", m)
	}
	if m["body_len"] != 46 {
		t.Fatalf("body_len=%v", m["body_len"])
	}
}

func TestParsePhotoNotify1209(t *testing.T) {
	rest := make([]byte, 27+8)
	copy(rest[0:21], []byte("B0001PIC"))
	rest[21] = 1
	rest[22] = 2
	binary.BigEndian.PutUint32(rest[23:27], 2048)
	copy(rest[27:], []byte("snap.jpg"))
	plate, patch, ok := parsePhotoNotify1209(rest)
	if !ok || plate != "B0001PIC" || patch["photo_lens"] != 2 || patch["photo_size"] != 2048 {
		t.Fatalf("%v", patch)
	}
	if patch["photo_file"] != "snap.jpg" {
		t.Fatalf("file=%v", patch["photo_file"])
	}
}

func TestParseVehicleOnline(t *testing.T) {
	rest := make([]byte, 28)
	copy(rest[0:21], []byte("B1111ON"))
	rest[21] = 1
	copy(rest[22:28], []byte{0x26, 0x10, 0x17, 0x08, 0x00, 0x00})
	plate, patch, ok := parseVehicleOnline(0x1205, rest)
	if !ok || plate != "B1111ON" || patch["vehicle_online"] != true {
		t.Fatalf("%v", patch)
	}
	if patch["online_time_bcd"] == nil {
		t.Fatalf("time missing: %v", patch)
	}
	_, patchOff, ok2 := parseVehicleOnline(0x1206, rest)
	if !ok2 || patchOff["vehicle_online"] != false {
		t.Fatalf("%v", patchOff)
	}
}

func TestParseVehicleList1500(t *testing.T) {
	rest := make([]byte, 23)
	copy(rest[0:21], []byte("B3333LST"))
	rest[21] = 2
	rest[22] = 1
	plate, patch, ok := parseVehicleList1500(rest)
	if !ok || plate != "B3333LST" || patch["vehicle_color"] != 2 || patch["vehicle_flag"] != 1 {
		t.Fatalf("plate=%q patch=%v", plate, patch)
	}
}

func TestParseMediaUpload160x(t *testing.T) {
	rest := make([]byte, 26+7)
	copy(rest[0:21], []byte("B2222UP"))
	rest[21] = 3
	binary.BigEndian.PutUint32(rest[22:26], 100)
	copy(rest[26:], []byte("pic.jpg"))
	plate, patch, ok := parseMediaUpload160x(0x1601, rest)
	if !ok || plate != "B2222UP" || patch["media_file"] != "pic.jpg" || patch["media_upload"] != true {
		t.Fatalf("%v", patch)
	}
	_, patch2, ok2 := parseMediaUpload160x(0x1602, rest)
	if !ok2 || patch2["media_complete"] != true {
		t.Fatalf("%v", patch2)
	}
}

func TestFlatten809InfoType_SOS(t *testing.T) {
	raw := map[string]any{}
	flatten809InfoType(1, raw)
	if raw["alarm.sos"] != true || raw["alarm_level"] != 2 {
		t.Fatalf("%v", raw)
	}
	flatten809InfoType(0, raw)
	if raw["alarm.sos"] != true {
		t.Fatal("zero should not clear")
	}
}

func TestParseVehicleStatic_Register(t *testing.T) {
	rest := make([]byte, 28+61)
	copy(rest[0:21], []byte("B1234REG"))
	rest[21] = 1
	binary.BigEndian.PutUint16(rest[22:24], 0x1201)
	binary.BigEndian.PutUint32(rest[24:28], 61)
	copy(rest[28:39], []byte("PLAT001"))
	copy(rest[39:50], []byte("PROD99"))
	copy(rest[50:70], []byte("MODEL-X"))
	copy(rest[70:77], []byte("TID1234"))
	copy(rest[77:89], []byte("13800138000"))
	plate, patch, ok := parseVehicleStatic(rest)
	if !ok || plate != "B1234REG" {
		t.Fatalf("ok=%v plate=%q", ok, plate)
	}
	if patch["platform_id"] != "PLAT001" || patch["producer_id"] != "PROD99" {
		t.Fatalf("%v", patch)
	}
	if patch["terminal_model"] != "MODEL-X" || patch["terminal_sim"] != "13800138000" {
		t.Fatalf("%v", patch)
	}
	// 0x1207 overlays ewaybill_notify on the same static parse.
	patch["proto_msg"] = "0x1207"
	patch["ewaybill_notify"] = true
	if patch["ewaybill_notify"] != true || patch["proto_msg"] != "0x1207" {
		t.Fatalf("ewaybill=%v", patch)
	}
}

func TestEncryptSkipStatus(t *testing.T) {
	m := encryptSkipStatus(0x1202, 1, 48)
	if m["encrypt_skip"] != true || m["encrypt_flag"] != 1 || m["body_len"] != 48 {
		t.Fatalf("%v", m)
	}
	if m["proto_msg"] != "0x1202" {
		t.Fatalf("proto=%v", m["proto_msg"])
	}
}

func TestParseDriverReport_Identity(t *testing.T) {
	rest := make([]byte, 99+9)
	copy(rest[0:21], []byte("B9999DRV"))
	rest[21] = 2
	rest[22] = 1 // login state
	copy(rest[23:39], []byte("Driver One"))
	copy(rest[39:59], []byte("ID1234567890"))
	copy(rest[59:99], []byte("LIC-998877"))
	copy(rest[99:], []byte("Org Fleet"))
	plate, patch, ok := parseDriverReport(rest)
	if !ok || plate != "B9999DRV" {
		t.Fatalf("ok=%v plate=%q", ok, plate)
	}
	if patch["driver_state"] != 1 || patch["driver_name"] != "Driver One" {
		t.Fatalf("%v", patch)
	}
	if patch["driver_id"] != "ID1234567890" || patch["driver_licence"] != "LIC-998877" {
		t.Fatalf("%v", patch)
	}
	if patch["driver_org"] != "Org Fleet" {
		t.Fatalf("%v", patch)
	}
}
