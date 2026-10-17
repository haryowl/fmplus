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
	m := parseSignalingPayload(0x04, []byte{0x01, 0x02, 0xaa, 0x05})
	if m["av_ptz_cmd"] != 1 || m["av_stream"] != 2 {
		t.Fatalf("%v", m)
	}
	if m["av_ptz_speed"] != 0xaa || m["av_ptz_param"] != 5 {
		t.Fatalf("speed/param=%v", m)
	}
	if m["av_payload_len"] != 4 {
		t.Fatalf("%v", m)
	}
}

func TestParseSignalingPayload_VideoSSRC(t *testing.T) {
	m := parseSignalingPayload(0x00, []byte{0x12, 0x34, 0x56, 0x78})
	if m["av_ssrc"] != uint32(0x12345678) {
		t.Fatalf("%v", m)
	}
	payload := []byte{0x12, 0x34, 0x56, 0x78, 0, 0, 0, 0, 0, 0, 0x01, 0x00}
	m2 := parseSignalingPayload(0x00, payload)
	if m2["av_timestamp"] != uint64(0x100) {
		t.Fatalf("ts=%v", m2["av_timestamp"])
	}
}

func TestParseSignalingHeader(t *testing.T) {
	hdr := make([]byte, 16)
	copy(hdr, []byte{0x30, 0x31, 0x63, 0x64, 0x00, 0x01, 0x00, 0x0a})
	hdr[14], hdr[15] = 0x00, 0x07
	m := parseSignalingHeader(hdr)
	if m["av_payload_declared"] != 10 || m["av_seq"] != 7 {
		t.Fatalf("%v", m)
	}
	if m["av_channel"] != 1 || m["av_datatype"] != 0 || m["av_live"] != true {
		t.Fatalf("%v", m)
	}
	if m["av_data_kind"] != "video_i" {
		t.Fatalf("kind=%v", m["av_data_kind"])
	}
	if m["av_pack_mark"] != "atomic" {
		t.Fatalf("pack=%v", m["av_pack_mark"])
	}
	hdr[4] = 0x10 // first + video_i
	m2 := parseSignalingHeader(hdr)
	if m2["av_pack_mark"] != "first" {
		t.Fatalf("first=%v", m2["av_pack_mark"])
	}
}
