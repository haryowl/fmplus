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

func TestEncodeDownlink_Driver8702(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8702"}, "13800138000")
	if err != nil || len(out) < 8 {
		t.Fatalf("err=%v len=%d", err, len(out))
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x87, 0x02}) {
		t.Fatalf("msg id missing: %x", raw)
	}
}

func TestEncodeDownlink_DrivingRecord8700(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8700", PayloadText: "collect"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x87, 0x00}) {
		t.Fatalf("%x", raw)
	}
}

func TestWrap8700Cmd(t *testing.T) {
	if wrap8700Cmd("") != 0 || wrap8700Cmd("0x15") != 0x15 {
		t.Fatal(wrap8700Cmd(""), wrap8700Cmd("0x15"))
	}
}

func TestWrap8300FlagText(t *testing.T) {
	f, msg := wrap8300FlagText("tts:hello")
	if f != 0x08 || msg != "hello" {
		t.Fatalf("f=%02x msg=%q", f, msg)
	}
}

func TestWrap9101Body(t *testing.T) {
	b := wrap9101Body("ch=2,ip=10.0.0.1,tcp=1078")
	if b[0] != 2 || b[3] != byte(len("10.0.0.1")) {
		t.Fatalf("%x", b)
	}
	if string(b[4:4+len("10.0.0.1")]) != "10.0.0.1" {
		t.Fatalf("%x", b)
	}
}

func TestWrap9102Body(t *testing.T) {
	b := wrap9102Body("ch=3,cmd=2")
	if b[0] != 3 || b[1] != 2 {
		t.Fatalf("%x", b)
	}
}

func TestParseAuth(t *testing.T) {
	m := parseAuth([]byte("AUTHCODE\x00"))
	if m["auth_code"] != "AUTHCODE" {
		t.Fatalf("%v", m)
	}
}

func TestWrap8203Body(t *testing.T) {
	b := wrap8203Body("sos")
	if binary.BigEndian.Uint32(b) != 1 {
		t.Fatalf("%x", b)
	}
}

func TestWrap8802Body(t *testing.T) {
	b := wrap8802Body("type=1,ch=2,event=3")
	if len(b) != 15 || b[0] != 1 || b[1] != 2 || b[2] != 3 {
		t.Fatalf("%x", b)
	}
}

func TestWrap8805Body(t *testing.T) {
	b := wrap8805Body("id=99")
	if binary.BigEndian.Uint32(b) != 99 {
		t.Fatalf("%x", b)
	}
}

func TestWrap8900Body(t *testing.T) {
	b := wrap8900Body("type=1,text=ab")
	if b[0] != 1 || string(b[1:]) != "ab" {
		t.Fatalf("%x", b)
	}
}

func TestGeofenceDelMsgID(t *testing.T) {
	if geofenceDelMsgID("type=rect,1,2") != 0x8603 {
		t.Fatal("rect")
	}
	if geofenceDelMsgID("type=poly,all") != 0x8605 {
		t.Fatal("poly")
	}
	if geofenceDelMsgID("type=route,1") != 0x8607 {
		t.Fatal("route")
	}
	if geofenceDelMsgID("1,2,3") != 0x8601 {
		t.Fatal("circle default")
	}
}

func TestWrap8606Body(t *testing.T) {
	b := wrap8606Body("id=9,w=40,pts=-6.1,106.7;-6.2,106.8")
	if binary.BigEndian.Uint32(b[0:4]) != 9 {
		t.Fatalf("id %x", b)
	}
	if binary.BigEndian.Uint16(b[6:8]) != 2 {
		t.Fatalf("count %x", b)
	}
	// first point: off 8 → ptid(4)+road(4)+lat(4)+lon(4)=16 → width at 8+16=24
	if b[24] != 40 {
		t.Fatalf("width byte=%d body=%x", b[24], b)
	}
}

func TestWrap8803Body(t *testing.T) {
	if string(wrap8803Body("stop")) != string([]byte{0, 1, 0}) {
		t.Fatalf("%x", wrap8803Body("stop"))
	}
	b := wrap8803Body("type=1,ch=2,cmd=1")
	if b[0] != 1 || b[1] != 2 || b[2] != 1 {
		t.Fatalf("%x", b)
	}
}

func TestWrap8106Body(t *testing.T) {
	b := wrap8106Body(nil, "0001,0002")
	if len(b) != 8 {
		t.Fatalf("%x", b)
	}
	if binary.BigEndian.Uint32(b[0:4]) != 1 || binary.BigEndian.Uint32(b[4:8]) != 2 {
		t.Fatalf("%x", b)
	}
}

func TestWrap8804Body(t *testing.T) {
	b := wrap8804Body("cmd=1,time=30,save=1,rate=2")
	if b[0] != 1 || binary.BigEndian.Uint16(b[1:3]) != 30 || b[3] != 1 || b[4] != 2 {
		t.Fatalf("%x", b)
	}
	if wrap8804Body("stop")[0] != 0 {
		t.Fatal("stop")
	}
}

func TestEncodeDownlink_RouteSet(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "geofence_set",
		PayloadText: "type=route,id=1,pts=0,0;0.001,0.001",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x86, 0x06}) {
		t.Fatalf("expected 0x8606: %x", raw)
	}
}

func TestEncodeDownlink_GeofenceDelRect(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "geofence_del",
		PayloadText: "type=rect,1,2",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x86, 0x03}) {
		t.Fatalf("expected 0x8603: %x", raw)
	}
}

func TestEncodeDownlink_MultimediaRetrieve8802(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "jt808_8802", PayloadText: "ch=3"}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x88, 0x02}) {
		t.Fatalf("msg id missing: %x", raw)
	}
	if !bytes.Contains(raw, []byte{0x00, 0x03, 0x00}) {
		t.Fatalf("type=0 ch=3 event=0 missing: %x", raw)
	}
}

func TestWrap8600Body(t *testing.T) {
	b := wrap8600Body("id=7,lat=-6.2,lon=106.8,r=250")
	if b[0] != 0 || b[1] != 1 {
		t.Fatalf("hdr %x", b)
	}
	if binary.BigEndian.Uint32(b[2:6]) != 7 {
		t.Fatalf("id %x", b)
	}
	if binary.BigEndian.Uint32(b[16:20]) != 250 {
		t.Fatalf("r %x", b)
	}
}

func TestWrap8602Body(t *testing.T) {
	b := wrap8602Body("id=3,lat1=-6.1,lon1=106.7,lat2=-6.3,lon2=106.9")
	if b[0] != 0 || b[1] != 1 || binary.BigEndian.Uint32(b[2:6]) != 3 {
		t.Fatalf("%x", b)
	}
	wantLat := int32(-6100000)
	if binary.BigEndian.Uint32(b[8:12]) != uint32(wantLat) {
		t.Fatalf("lat1 %x", b)
	}
}

func TestLooksLikeRectGeofence(t *testing.T) {
	if !looksLikeRectGeofence("type=rect,id=1") || !looksLikeRectGeofence("lat1=1,lat2=2") {
		t.Fatal("expected rect")
	}
	if looksLikeRectGeofence("id=1,lat=-6,lon=106,r=100") {
		t.Fatal("circle should not look like rect")
	}
}

func TestEncodeDownlink_GeofenceSetRect(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "geofence_set",
		PayloadText: "type=rect,id=2,lat1=-6.1,lon1=106.7,lat2=-6.3,lon2=106.9",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x86, 0x02}) {
		t.Fatalf("expected 0x8602: %x", raw)
	}
}

func TestWrap8604Body(t *testing.T) {
	b := wrap8604Body("id=5,pts=-6.1,106.7;-6.2,106.8;-6.1,106.9")
	if b[0] != 0 || b[1] != 1 || binary.BigEndian.Uint32(b[2:6]) != 5 {
		t.Fatalf("%x", b)
	}
	if binary.BigEndian.Uint16(b[8:10]) != 3 {
		t.Fatalf("vertex count %x", b)
	}
	if !looksLikePolyGeofence("type=poly,id=1") || !looksLikePolyGeofence("pts=1,2;3,4;5,6") {
		t.Fatal("looksLikePolyGeofence")
	}
}

func TestWrap8304Body(t *testing.T) {
	b := wrap8304Body("type=2,text=Hi")
	if b[0] != 2 || binary.BigEndian.Uint32(b[1:5]) != 2 || string(b[5:]) != "Hi" {
		t.Fatalf("%x", b)
	}
}

func TestWrap8400Body(t *testing.T) {
	b := wrap8400Body("13800138000")
	if b[0] != 0 || string(b[1:]) != "13800138000" {
		t.Fatalf("%x", b)
	}
	b2 := wrap8400Body("listen:13900139000")
	if b2[0] != 1 || string(b2[1:]) != "13900139000" {
		t.Fatalf("%x", b2)
	}
}

func TestWrap8401Body(t *testing.T) {
	if wrap8401Body("clear")[0] != 0 {
		t.Fatal("clear")
	}
	b := wrap8401Body("type=1,items=1:13800138000:Home")
	if b[0] != 1 || b[1] != 1 || b[2] != 1 {
		t.Fatalf("%x", b)
	}
	if b[3] != 11 || string(b[4:15]) != "13800138000" {
		t.Fatalf("num %x", b)
	}
}

func TestEncodeDownlink_PhoneCallback(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "phone_callback", PayloadText: "13800138000",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if binary.BigEndian.Uint16(raw[0:2]) != 0x8400 {
		t.Fatalf("msgID=%04x", binary.BigEndian.Uint16(raw[0:2]))
	}
}

func TestWrap8303Body(t *testing.T) {
	if wrap8303Body("clear")[0] != 0 {
		t.Fatal("clear")
	}
	b := wrap8303Body("type=1,items=1:News;2:Wx")
	if b[0] != 1 || b[1] != 2 || b[2] != 1 || b[3] != 4 || string(b[4:8]) != "News" {
		t.Fatalf("%x", b)
	}
}

func TestEncodeDownlink_PolyGeofence(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{
		CommandType: "geofence_set",
		PayloadText: "type=poly,id=1,pts=0,0;0.001,0;0,0.001",
	}, "13800138000")
	if err != nil {
		t.Fatal(err)
	}
	raw := unescape(out)
	if !bytes.Contains(raw, []byte{0x86, 0x04}) {
		t.Fatalf("expected 0x8604: %x", raw)
	}
}

func TestWrap8301Body(t *testing.T) {
	b := wrap8301Body("id=2,text=SOS")
	if b[0] != 1 || b[1] != 2 || b[2] != 3 || string(b[3:]) != "SOS" {
		t.Fatalf("%x", b)
	}
	b2 := wrap8301Body("1:A;2:B")
	if b2[0] != 2 {
		t.Fatalf("%x", b2)
	}
}

func TestWrap8302Body(t *testing.T) {
	b := wrap8302Body("id=3,q=OK?")
	if b[0] != 0 || b[1] != 3 || b[2] != 3 || string(b[3:]) != "OK?" {
		t.Fatalf("%x", b)
	}
}

func TestParseQuestionAnswer(t *testing.T) {
	body := []byte{0x00, 0x0a, 0x01, 'Y', 'e', 's'}
	m := parseQuestionAnswer(body)
	if m["reply_seq"] != 10 || m["answer_id"] != 1 || m["answer_text"] != "Yes" {
		t.Fatalf("%v", m)
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
