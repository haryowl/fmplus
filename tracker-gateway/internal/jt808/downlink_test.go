package jt808

import (
	"encoding/binary"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestEncodeDownlink_Text8300(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "text", PayloadText: "hello"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if len(raw) < 14 {
		t.Fatalf("short frame %x", out)
	}
	msg := raw[:len(raw)-1]
	if bcc(msg) != raw[len(raw)-1] {
		t.Fatal("bcc mismatch")
	}
	if binary.BigEndian.Uint16(msg[0:2]) != 0x8300 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(msg[0:2]))
	}
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	body := msg[12 : 12+bodyLen]
	if body[0] != 0x01 || string(body[1:]) != "hello" {
		t.Fatalf("body=%x", body)
	}
	phone := bcdPhone(msg[4:10])
	if phone != "13800138000" {
		t.Fatalf("phone=%q", phone)
	}
}

func TestEncodeDownlink_Control8500(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8500", PayloadText: "cut"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	msg := raw[:len(raw)-1]
	if binary.BigEndian.Uint16(msg[0:2]) != 0x8500 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(msg[0:2]))
	}
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	body := msg[12 : 12+bodyLen]
	if len(body) != 1 || body[0] != 1 {
		t.Fatalf("flag body=%x want [01]", body)
	}
}

func TestEncodeDownlink_Param8103(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "jt808_8103",
		PayloadHex:  "00010203",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	msg := raw[:len(raw)-1]
	if binary.BigEndian.Uint16(msg[0:2]) != 0x8103 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(msg[0:2]))
	}
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	body := msg[12 : 12+bodyLen]
	if len(body) != 5 || body[0] != 1 {
		t.Fatalf("body=%x", body)
	}
	if body[1] != 0x00 || body[2] != 0x01 || body[3] != 0x02 || body[4] != 0x03 {
		t.Fatalf("params=%x", body[1:])
	}
}

func TestEncodeDownlink_Param8103_MultiTLV(t *testing.T) {
	// count=2, param id 0x0001 len1 val 0x0A, param id 0x0002 len1 val 0x0B
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "jt808_8103",
		PayloadHex:  "0200000001010a00000002010b",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	msg := raw[:len(raw)-1]
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	body := msg[12 : 12+bodyLen]
	if body[0] != 2 {
		t.Fatalf("should not double-wrap count; body=%x", body)
	}
	if !looksLike8103Body(body) {
		t.Fatalf("body not valid 8103 %x", body)
	}
}

func TestLooksLike8103Body(t *testing.T) {
	if looksLike8103Body([]byte{0x00, 0x01, 0x02, 0x03}) {
		t.Fatal("raw TLV without count should be false")
	}
	ok := []byte{0x01, 0x00, 0x00, 0x00, 0x55, 0x01, 0xff}
	if !looksLike8103Body(ok) {
		t.Fatalf("single param %x", ok)
	}
}

func TestEncodeDownlink_RequiresPhone(t *testing.T) {
	ad := Adapter{}
	_, err := ad.EncodeDownlink(store.Command{PayloadText: "x"}, "")
	if err == nil {
		t.Fatal("expected phone required")
	}
}

func TestEscapeRoundTrip(t *testing.T) {
	in := []byte{0x30, 0x7e, 0x01, 0x7d, 0x02}
	framed := escape(in)
	got := unescape(framed)
	if string(got) != string(in) {
		t.Fatalf("got %x want %x", got, in)
	}
}
