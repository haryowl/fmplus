package jt808

import (
	"bytes"
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

func TestEncodeDownlink_Query8104_All(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8104", PayloadText: "all"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	msg := raw[:len(raw)-1]
	if binary.BigEndian.Uint16(msg[0:2]) != 0x8104 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(msg[0:2]))
	}
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	body := msg[12 : 12+bodyLen]
	if len(body) != 1 || body[0] != 0 {
		t.Fatalf("body=%x want [00]", body)
	}
}

func TestEncodeDownlink_Terminal8105(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8105", PayloadText: "reset"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	msg := raw[:len(raw)-1]
	if binary.BigEndian.Uint16(msg[0:2]) != 0x8105 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(msg[0:2]))
	}
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	body := msg[12 : 12+bodyLen]
	if len(body) != 1 || body[0] != 3 {
		t.Fatalf("body=%x want [03]", body)
	}
	if wrap8105Flag("", "shutdown") != 2 || wrap8105Flag("04", "") != 4 {
		t.Fatal("wrap8105Flag")
	}
	multi, err := ad.EncodeDownlink(store.Command{
		CommandType: "jt808_8105", PayloadHex: "00616263",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	mraw := unescape(multi)
	mbodyLen := int(binary.BigEndian.Uint16(mraw[2:4]) & 0x3ff)
	mbody := mraw[12 : 12+mbodyLen]
	if len(mbody) != 4 || mbody[0] != 0 || string(mbody[1:]) != "abc" {
		t.Fatalf("multi8105=%x", mbody)
	}
}

func TestEncodeDownlink_Hex8300And8500(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "text", PayloadHex: "48656c6c6f", // Hello without flag
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	bodyLen := int(binary.BigEndian.Uint16(raw[2:4]) & 0x3ff)
	body := raw[12 : 12+bodyLen]
	if body[0] != 0x01 || string(body[1:]) != "Hello" {
		t.Fatalf("8300 hex body=%x", body)
	}
	withFlag, err := ad.EncodeDownlink(store.Command{
		CommandType: "text", PayloadHex: "014849",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	wraw := unescape(withFlag)
	wlen := int(binary.BigEndian.Uint16(wraw[2:4]) & 0x3ff)
	wbody := wraw[12 : 12+wlen]
	if len(wbody) != 3 || wbody[0] != 0x01 {
		t.Fatalf("flag body=%x", wbody)
	}
	ctrl, err := ad.EncodeDownlink(store.Command{
		CommandType: "jt808_8500", PayloadHex: "0102",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	craw := unescape(ctrl)
	if binary.BigEndian.Uint16(craw[0:2]) != 0x8500 {
		t.Fatalf("msg=%04x", binary.BigEndian.Uint16(craw[0:2]))
	}
	clen := int(binary.BigEndian.Uint16(craw[2:4]) & 0x3ff)
	cbody := craw[12 : 12+clen]
	if len(cbody) != 2 || cbody[0] != 1 || cbody[1] != 2 {
		t.Fatalf("8500 multi=%x", cbody)
	}
}

func TestEncodeDownlink_Query8201(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8201"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	msg := raw[:len(raw)-1]
	if binary.BigEndian.Uint16(msg[0:2]) != 0x8201 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(msg[0:2]))
	}
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	if bodyLen != 0 {
		t.Fatalf("bodyLen=%d", bodyLen)
	}
}

func TestEncodeDownlink_Query8107(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8107"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	msg := raw[:len(raw)-1]
	if binary.BigEndian.Uint16(msg[0:2]) != 0x8107 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(msg[0:2]))
	}
	bodyLen := int(binary.BigEndian.Uint16(msg[2:4]) & 0x3ff)
	if bodyLen != 0 {
		t.Fatalf("bodyLen=%d", bodyLen)
	}
}

func TestWrap8104Body_IDs(t *testing.T) {
	b := wrap8104Body(nil, "0001,0002")
	if len(b) != 1+8 || b[0] != 2 {
		t.Fatalf("%x", b)
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

func TestEncodeDownlink_Camera8801(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8801", PayloadText: "2"}, "13800138000")
	if err != nil || len(out) < 10 {
		t.Fatalf("err=%v len=%d", err, len(out))
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x02, 0x01, 0x00, 0x00}) {
		t.Fatalf("expected ch=2 cmd=1 in body, raw=%x", raw)
	}
}

func TestEncodeDownlink_Track8202(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8202", PayloadText: "5,30"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x00, 0x05, 0x00, 0x00, 0x00, 0x1e}) {
		t.Fatalf("interval/validity missing: %x", raw)
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
