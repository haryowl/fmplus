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
	binary.BigEndian.PutUint32(rest[off:], 0x01) // ACC
	off += 4
	binary.BigEndian.PutUint32(rest[off:], 0x02) // alarm nonzero

	fix, _, ok := parseVehicleUplink(0x1202, rest)
	if !ok || fix.Altitude == nil || *fix.Altitude != 120 {
		t.Fatalf("alt=%v ok=%v", fix.Altitude, ok)
	}
	if fix.RawAttrs["vehicle_state"] != 1 || fix.RawAttrs["status.acc"] != true {
		t.Fatalf("%v", fix.RawAttrs)
	}
	if fix.RawAttrs["alarm.gnss"] != true {
		t.Fatalf("alarm %v", fix.RawAttrs)
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
