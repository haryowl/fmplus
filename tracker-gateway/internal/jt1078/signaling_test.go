package jt1078

import "testing"

func TestExtractSIMHint(t *testing.T) {
	if got := extractSIMHint([]byte("13800138000abc")); got != "13800138000" {
		t.Fatalf("got=%q", got)
	}
	if extractSIMHint([]byte("short99")) != "" {
		t.Fatal("expected empty for short digit run")
	}
	if extractSIMHint([]byte{0x00, 0x01, '1', '3', '8', '0', '0', '1', '3', '8', '0', '0', '0'}) != "13800138000" {
		t.Fatal("expected digits after binary prefix")
	}
}

func TestAvDataKind(t *testing.T) {
	if avDataKind(0x00) != "video_i" || avDataKind(0x03) != "audio" {
		t.Fatal(avDataKind(0), avDataKind(3))
	}
}

func TestBcdSIM(t *testing.T) {
	// 013800138000 → trim leading 0 → 13800138000
	b := []byte{0x01, 0x38, 0x00, 0x13, 0x80, 0x00}
	if got := bcdSIM(b); got != "13800138000" {
		t.Fatalf("got=%q", got)
	}
	if bcdSIM([]byte{0x00, 0x00}) != "" {
		t.Fatal("short BCD")
	}
}

func TestParseSignalingPayload_PTZ(t *testing.T) {
	m := parseSignalingPayload(0x04, []byte{0x01, 0x02, 0xaa})
	if m["av_ptz_cmd"] != 1 || m["av_stream"] != 2 {
		t.Fatalf("%v", m)
	}
	if m["av_payload_len"] != 3 {
		t.Fatalf("%v", m)
	}
}

func TestParseSignalingPayload_VideoSSRC(t *testing.T) {
	m := parseSignalingPayload(0x00, []byte{0x12, 0x34, 0x56, 0x78})
	if m["av_ssrc"] != uint32(0x12345678) {
		t.Fatalf("%v", m)
	}
}
