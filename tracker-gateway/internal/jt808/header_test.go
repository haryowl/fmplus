package jt808

import (
	"encoding/binary"
	"testing"
)

func TestParseMessageHeader_2011(t *testing.T) {
	msg := make([]byte, 12)
	binary.BigEndian.PutUint16(msg[0:2], 0x0200)
	binary.BigEndian.PutUint16(msg[2:4], 28)
	// phone 013800138000
	phone := "013800138000"
	for i := 0; i < 6; i++ {
		hi := phone[i*2] - '0'
		lo := phone[i*2+1] - '0'
		msg[4+i] = (hi << 4) | lo
	}
	binary.BigEndian.PutUint16(msg[10:12], 7)
	body := make([]byte, 28)
	msg = append(msg, body...)
	h, ok := parseMessageHeader(msg)
	if !ok || h.Version2019 || h.Phone != "13800138000" || h.Seq != 7 || h.HeaderLen != 12 {
		t.Fatalf("%+v ok=%v", h, ok)
	}
	if len(h.Body(msg)) != 28 {
		t.Fatalf("body len=%d", len(h.Body(msg)))
	}
}

func TestParseMessageHeader_2019(t *testing.T) {
	msg := make([]byte, 17)
	binary.BigEndian.PutUint16(msg[0:2], 0x0200)
	binary.BigEndian.PutUint16(msg[2:4], 0x4000|10) // version + body len 10
	msg[4] = 1
	digits := "00013800138000" // pad to 20 for 10 BCD
	for len(digits) < 20 {
		digits = "0" + digits
	}
	for i := 0; i < 10; i++ {
		hi := digits[i*2] - '0'
		lo := digits[i*2+1] - '0'
		msg[5+i] = (hi << 4) | lo
	}
	binary.BigEndian.PutUint16(msg[15:17], 9)
	msg = append(msg, make([]byte, 10)...)
	h, ok := parseMessageHeader(msg)
	if !ok || !h.Version2019 || h.ProtocolVer != 1 || h.Seq != 9 || h.HeaderLen != 17 {
		t.Fatalf("%+v ok=%v", h, ok)
	}
	if h.Phone != "13800138000" {
		t.Fatalf("phone=%q", h.Phone)
	}
}

func TestParseMessageHeader_2011Subpkg(t *testing.T) {
	msg := make([]byte, 16)
	binary.BigEndian.PutUint16(msg[0:2], 0x0704)
	binary.BigEndian.PutUint16(msg[2:4], 0x2000|4)
	phone := "013800138000"
	for i := 0; i < 6; i++ {
		hi := phone[i*2] - '0'
		lo := phone[i*2+1] - '0'
		msg[4+i] = (hi << 4) | lo
	}
	binary.BigEndian.PutUint16(msg[10:12], 1)
	binary.BigEndian.PutUint16(msg[12:14], 2)
	binary.BigEndian.PutUint16(msg[14:16], 1)
	msg = append(msg, 0xaa, 0xbb, 0xcc, 0xdd)
	h, ok := parseMessageHeader(msg)
	if !ok || !h.Subpackaged || h.TotalPkgs != 2 || h.PkgIndex != 1 || h.HeaderLen != 16 {
		t.Fatalf("%+v", h)
	}
}

func TestPackAndParse_2019RoundTrip(t *testing.T) {
	body := []byte{1, 2, 3}
	hdr := packJT808Header(0x8001, body, "13800138000", 42, true)
	msg := append(hdr, body...)
	h, ok := parseMessageHeader(msg)
	if !ok || !h.Version2019 || h.Seq != 42 || h.MsgID != 0x8001 {
		t.Fatalf("%+v", h)
	}
}

func TestDownlinkCorrID(t *testing.T) {
	framed := buildDownlinkFrame("13800138000", nil, 0x8300, []byte{0x01, 'x'})
	if DownlinkCorrID(framed) != "1" {
		t.Fatalf("corr=%s", DownlinkCorrID(framed))
	}
}
