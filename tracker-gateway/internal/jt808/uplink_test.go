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
}

func TestParseTerminalAttrs_Minimal(t *testing.T) {
	body := make([]byte, 1+5+20+7+10)
	body[0] = 0x01
	copy(body[1:6], []byte("MFR01"))
	copy(body[6:26], []byte("MODEL-ABC"))
	copy(body[26:33], []byte("TID1234"))
	// ICCID BCD zeros ok
	m := parseTerminalAttrs(body)
	if m["manufacturer"] != "MFR01" {
		t.Fatalf("%v", m["manufacturer"])
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
	fail := parseUpgradeResult([]byte{0x00, 0x01})
	if fail["upgrade_result"] != 1 {
		t.Fatalf("%v", fail)
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
}

func TestBcdNowUTC6(t *testing.T) {
	b := bcdNowUTC6()
	if len(b) != 6 {
		t.Fatalf("len=%d", len(b))
	}
}

func TestParseCANBus(t *testing.T) {
	body := make([]byte, 10)
	binary.BigEndian.PutUint16(body[0:2], 3)
	m := parseCANBus(body)
	if m["can_item_count"] != 3 {
		t.Fatalf("%v", m)
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
	ids, _ := m["media_ids"].([]uint32)
	if len(ids) != 2 || ids[0] != 10 || ids[1] != 11 {
		t.Fatalf("ids=%v", ids)
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
