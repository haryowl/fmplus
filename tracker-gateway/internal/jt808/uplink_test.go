package jt808

import (
	"testing"
)

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
