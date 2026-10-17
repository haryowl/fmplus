package jt808

import (
	"encoding/binary"
	"testing"
)

func TestParseDriverIdentity(t *testing.T) {
	// state=1, time 6 bytes, ic=0, name len=4 "John"
	body := []byte{0x01, 0x24, 0x06, 0x01, 0x10, 0x30, 0x00, 0x00, 0x04}
	body = append(body, []byte("John")...)
	body = append(body, []byte("CERT123")...)
	m := parseDriverIdentity(body)
	if m["driver_state"] != 1 || m["driver_name"] != "John" {
		t.Fatalf("%v", m)
	}
	if m["driver_cert"] != "CERT123" {
		t.Fatalf("cert=%v", m["driver_cert"])
	}
	if m["driver.ic_login"] != true || m["driver.ic_name"] != "John" {
		t.Fatalf("login keys=%v", m)
	}
	ev := safetyFromDriverIdentity(m, "jt808")
	if ev == nil || ev.AlarmType != "driver_ic_login" {
		t.Fatalf("safety=%+v", ev)
	}
}

func TestParseTerminalAttrs_Minimal(t *testing.T) {
	body := make([]byte, 1+5+20+7+10+1+3+1+3)
	body[0] = 0x01
	copy(body[1:6], []byte("MFR01"))
	copy(body[6:26], []byte("MODEL-ABC"))
	copy(body[26:33], []byte("TID1234"))
	// ICCID BCD zeros ok
	off := 43
	body[off] = 3
	copy(body[off+1:], []byte("1.0"))
	off += 4
	body[off] = 3
	copy(body[off+1:], []byte("2.1"))
	m := parseTerminalAttrs(body)
	if m["manufacturer"] != "MFR01" {
		t.Fatalf("%v", m["manufacturer"])
	}
	if m["device.manufacturer"] != "MFR01" || m["device.hw_ver"] != "1.0" || m["device.fw_ver"] != "2.1" {
		t.Fatalf("aliases=%v", m)
	}
	if m["terminal_model"] != "MODEL-ABC" {
		t.Fatalf("%v", m["terminal_model"])
	}
}

func TestSafetyFromEventID_SOS(t *testing.T) {
	ev := safetyFromEventID(1, "jt808")
	if ev == nil || ev.AlarmType != "sos" || ev.AlarmLevel != 2 {
		t.Fatalf("%+v", ev)
	}
	if safetyFromEventID(0, "jt808") != nil {
		t.Fatal("event 0")
	}
}

func TestParseUpgradeResult(t *testing.T) {
	m := parseUpgradeResult([]byte{0x00, 0x00})
	if m["upgrade_type"] != 0 || m["upgrade_result"] != 0 {
		t.Fatalf("%v", m)
	}
	if m["upgrade_ok"] != true || m["upgrade_kind"] != "terminal" {
		t.Fatalf("ok/kind=%v", m)
	}
	fail := parseUpgradeResult([]byte{0x00, 0x01})
	if fail["upgrade_result"] != 1 || fail["upgrade_ok"] != false {
		t.Fatalf("%v", fail)
	}
}

func TestParseTerminalParamsOK_0106Shape(t *testing.T) {
	// count=1, id=0x0001, len=1, val=0x2a — same TLV layout for 0x0104 and 0x0106.
	body := []byte{0x01, 0x00, 0x00, 0x00, 0x01, 0x01, 0x2a}
	out, ok := parseTerminalParamsOK(body)
	if !ok || out["param.0x0001"] != 0x2a {
		t.Fatalf("%v ok=%v", out, ok)
	}
	out["proto_msg"] = "0x0106"
	if out["proto_msg"] != "0x0106" || out["params_parsed"] != 1 {
		t.Fatalf("%v", out)
	}
}

func TestParseMultimediaData(t *testing.T) {
	body := make([]byte, 12)
	binary.BigEndian.PutUint32(body[0:4], 99)
	body[4], body[5], body[6], body[7] = 0, 1, 2, 3
	m := parseMultimediaData(body)
	if m["media_id"] != uint32(99) || m["media_channel"] != 2 {
		t.Fatalf("%v", m)
	}
	long := make([]byte, 36)
	binary.BigEndian.PutUint32(long[0:4], 7)
	long[4], long[5], long[6], long[7] = 0, 1, 2, 3
	m2 := parseMultimediaData(long)
	if m2["media_has_location"] != true {
		t.Fatalf("%v", m2)
	}
	if loc := multimediaLocationBody(long); len(loc) != 28 {
		t.Fatalf("loc=%d", len(loc))
	}
}

func TestBcdNowUTC6(t *testing.T) {
	b := bcdNowUTC6()
	if len(b) != 6 {
		t.Fatalf("len=%d", len(b))
	}
}

func TestParseCANBus(t *testing.T) {
	// count=1, BCD 5 bytes, one item: id=0x18FEEF00 + 8 data
	body := make([]byte, 2+5+12)
	binary.BigEndian.PutUint16(body[0:2], 1)
	copy(body[2:7], []byte{0x12, 0x30, 0x00, 0x00, 0x00})
	binary.BigEndian.PutUint32(body[7:11], 0x18FEEF00)
	copy(body[11:19], []byte{1, 2, 3, 4, 5, 6, 7, 8})
	m := parseCANBus(body)
	if m["can_item_count"] != 1 || m["can_parsed"] != 1 {
		t.Fatalf("%v", m)
	}
	if m["can.0.id"] != int(0x18FEEF00) || m["can.0.data"] != "0102030405060708" {
		t.Fatalf("%v", m)
	}
	if m["can.0.data0"] != 1 || m["can.first_id"] != int(0x18FEEF00) {
		t.Fatalf("first=%v", m)
	}
}

func TestParseDrivingRecord(t *testing.T) {
	m := parseDrivingRecord([]byte{0x15, 0x01, 0x02})
	if m["drv_cmd"] != 0x15 {
		t.Fatalf("%v", m)
	}
	m2 := parseDrivingRecord([]byte{0x03})
	if m2["drv_cmd_name"] != "odometer" {
		t.Fatalf("%v", m2)
	}
}

func TestParseRegister(t *testing.T) {
	body := make([]byte, 4+5+20+7+1+6)
	binary.BigEndian.PutUint16(body[0:2], 11)
	binary.BigEndian.PutUint16(body[2:4], 101)
	copy(body[4:9], []byte("MFR01"))
	copy(body[9:29], []byte("MODEL-X"))
	copy(body[29:36], []byte("TID0001"))
	body[36] = 2
	copy(body[37:], []byte("B12345"))
	m := parseRegister(body)
	if m["province_id"] != 11 || m["manufacturer"] != "MFR01" || m["vehicle_plate"] != "B12345" {
		t.Fatalf("%v", m)
	}
	if m["vehicle.province"] != 11 || m["vehicle.plate"] != "B12345" || m["device.model"] != "MODEL-X" {
		t.Fatalf("aliases=%v", m)
	}
}

func TestWrap8601Body(t *testing.T) {
	if len(wrap8601Body("all")) != 1 || wrap8601Body("all")[0] != 0 {
		t.Fatal("all")
	}
	b := wrap8601Body("1,2")
	if b[0] != 2 || binary.BigEndian.Uint32(b[1:5]) != 1 || binary.BigEndian.Uint32(b[5:9]) != 2 {
		t.Fatalf("%x", b)
	}
}

func TestParseCameraShootResp(t *testing.T) {
	body := make([]byte, 4+8)
	binary.BigEndian.PutUint16(body[0:2], 42)
	body[2] = 0
	body[3] = 2
	binary.BigEndian.PutUint32(body[4:8], 10)
	binary.BigEndian.PutUint32(body[8:12], 11)
	m := parseCameraShootResp(body)
	if m["reply_seq"] != 42 || m["shoot_result"] != 0 || m["media_id_count"] != 2 {
		t.Fatalf("%v", m)
	}
	if m["shoot_ok"] != true || m["media_id"] != 10 {
		t.Fatalf("ok/id=%v", m)
	}
	ids, _ := m["media_ids"].([]uint32)
	if len(ids) != 2 || ids[0] != 10 || ids[1] != 11 {
		t.Fatalf("ids=%v", ids)
	}
}

func TestParseMultimediaRetrieveResp(t *testing.T) {
	body := make([]byte, 13)
	binary.BigEndian.PutUint16(body[0:2], 7)
	binary.BigEndian.PutUint32(body[2:6], 1)
	binary.BigEndian.PutUint32(body[6:10], 99)
	body[10] = 0
	body[11] = 1
	body[12] = 2
	m := parseMultimediaRetrieveResp(body)
	if m["reply_seq"] != 7 || m["media_count"] != 1 || m["media_id"] != uint32(99) {
		t.Fatalf("%v", m)
	}
	if m["media_channel"] != 1 || m["media_event"] != 2 {
		t.Fatalf("%v", m)
	}
	long := make([]byte, 41)
	copy(long, body)
	m2 := parseMultimediaRetrieveResp(long)
	if m2["media_has_location"] != true {
		t.Fatalf("%v", m2)
	}
	if loc := multimediaRetrieveLocationBody(long); len(loc) != 28 {
		t.Fatalf("loc=%d", len(loc))
	}
}

func putI32BE(b []byte, v int32) {
	binary.BigEndian.PutUint32(b, uint32(v))
}

func TestParseAreaQueryResp_Circle(t *testing.T) {
	body := make([]byte, 5+18)
	body[0] = 1 // circle
	binary.BigEndian.PutUint32(body[1:5], 1)
	binary.BigEndian.PutUint32(body[5:9], 42)
	binary.BigEndian.PutUint16(body[9:11], 0)
	putI32BE(body[11:15], -6200000)
	putI32BE(body[15:19], 106800000)
	binary.BigEndian.PutUint32(body[19:23], 500)
	m := parseAreaQueryResp(body)
	if m["geofence.id"] != uint32(42) || m["geofence.radius"] != uint32(500) {
		t.Fatalf("%v", m)
	}
	if m["area_query_kind"] != "circle" {
		t.Fatalf("kind=%v", m["area_query_kind"])
	}
	if m["geofence.lat"].(float64) > -6.19 || m["geofence.lat"].(float64) < -6.21 {
		t.Fatalf("lat=%v", m["geofence.lat"])
	}
	if m["area_count"] != 1 {
		t.Fatalf("area_count=%v", m["area_count"])
	}
	if _, ok := m["geofence.attr"]; !ok {
		t.Fatalf("geofence.attr missing: %v", m)
	}
}

func TestParseAreaQueryResp_Route(t *testing.T) {
	body := make([]byte, 5+18)
	body[0] = 4 // route
	binary.BigEndian.PutUint32(body[1:5], 1)
	binary.BigEndian.PutUint32(body[5:9], 3) // id
	binary.BigEndian.PutUint16(body[9:11], 0)
	binary.BigEndian.PutUint16(body[11:13], 50) // width
	binary.BigEndian.PutUint16(body[13:15], 2)  // points
	putI32BE(body[15:19], -6200000)
	putI32BE(body[19:23], 106800000)
	m := parseAreaQueryResp(body)
	if m["route.width"] != 50 || m["route.point_count"] != 2 {
		t.Fatalf("%v", m)
	}
	if m["route.lat"].(float64) > -6.19 || m["route.lat"].(float64) < -6.21 {
		t.Fatalf("lat=%v", m["route.lat"])
	}
}

func TestParseAreaQueryResp_Rect(t *testing.T) {
	body := make([]byte, 5+22)
	body[0] = 2
	binary.BigEndian.PutUint32(body[1:5], 1)
	binary.BigEndian.PutUint32(body[5:9], 9)
	putI32BE(body[11:15], -6100000)
	putI32BE(body[15:19], 106700000)
	putI32BE(body[19:23], -6300000)
	putI32BE(body[23:27], 106900000)
	m := parseAreaQueryResp(body)
	if m["geofence.id"] != uint32(9) || m["geofence.lat2"] == nil {
		t.Fatalf("%v", m)
	}
}

func TestSafetyFromEventID_Expanded(t *testing.T) {
	cases := map[int]string{
		5: "enter_area", 6: "leave_area", 12: "collision", 14: "driver_change",
	}
	for id, want := range cases {
		ev := safetyFromEventID(id, "jt808")
		if ev == nil || ev.AlarmType != want {
			t.Fatalf("id=%d ev=%+v want %s", id, ev, want)
		}
	}
}

func TestBuildDownlink_OutboundSubpkg(t *testing.T) {
	body := make([]byte, jt808MaxBody+10)
	for i := range body {
		body[i] = byte(i)
	}
	var seq uint16
	framed := buildDownlinkFrameVer("13800138000", &seq, 0x8300, body, false)
	if DownlinkCorrID(framed) != "1" {
		t.Fatalf("first corr=%s seq=%d", DownlinkCorrID(framed), seq)
	}
	if seq < 2 {
		t.Fatalf("expected multiple seqs, got %d", seq)
	}
	// two frames both start with 0x7e
	n7e := 0
	for _, b := range framed {
		if b == 0x7e {
			n7e++
		}
	}
	if n7e < 4 {
		t.Fatalf("expected ≥2 frames (4 0x7e), got %d", n7e)
	}
}
