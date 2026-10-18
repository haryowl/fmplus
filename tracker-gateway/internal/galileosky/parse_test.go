package galileosky

import (
	"encoding/binary"
	"encoding/hex"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestParseTags_IMEIAndCoords(t *testing.T) {
	imei := "352094081234567"
	payload := []byte{0x03}
	payload = append(payload, []byte(imei)...)
	payload = append(payload, 0x30)
	// Official example: flags + lat LE + lon LE (≈53.51°, 86.890424°)
	coords, err := hex.DecodeString("07c00e3203b8d72d05")
	if err != nil {
		t.Fatal(err)
	}
	payload = append(payload, coords...)

	tags := parseTags(payload)
	if string(tags[0x03]) != imei {
		t.Fatalf("imei tag=%q", tags[0x03])
	}
	if len(tags[0x30]) != 9 {
		t.Fatalf("coords len=%d", len(tags[0x30]))
	}
	fix, ok := fixFromTags(tags)
	if !ok {
		t.Fatal("fixFromTags failed")
	}
	if fix.Lat < 53.5 || fix.Lat > 53.7 {
		t.Fatalf("lat=%v", fix.Lat)
	}
	if fix.Lon < 86.8 || fix.Lon > 86.9 {
		t.Fatalf("lon=%v", fix.Lon)
	}
	if fix.Satellites == nil || *fix.Satellites != 7 {
		t.Fatalf("sats=%v", fix.Satellites)
	}
}

func TestParseTagRecords_MultiCoords(t *testing.T) {
	imei := "352094081234567"
	coords, _ := hex.DecodeString("07c00e3203b8d72d05")
	payload := []byte{0x03}
	payload = append(payload, []byte(imei)...)
	payload = append(payload, 0x30)
	payload = append(payload, coords...)
	payload = append(payload, 0x30)
	payload = append(payload, coords...)
	recs := parseTagRecords(payload)
	if len(recs) != 2 {
		t.Fatalf("recs=%d", len(recs))
	}
	if string(recs[0][0x03]) != imei || string(recs[1][0x03]) != imei {
		t.Fatalf("imei not shared: %q / %q", recs[0][0x03], recs[1][0x03])
	}
	if len(recs[0][0x30]) != 9 || len(recs[1][0x30]) != 9 {
		t.Fatal("coords")
	}
}

func TestTagSize_Official(t *testing.T) {
	cases := map[byte]int{
		0x01: 1, 0x03: 15, 0x04: 2, 0x10: 2, 0x20: 4, 0x30: 9, 0x33: 4, 0x34: 2, 0x35: 1,
		0x40: 2, 0x41: 2, 0x42: 2, 0x43: 1, 0x44: 4, 0x45: 2, 0x46: 2, 0x47: 4,
		0x50: 2, 0x5a: 4, 0x60: 2, 0x63: 3, 0x70: 2, 0x80: 3, 0x90: 4,
		0xa0: 1, 0xb0: 2, 0xc0: 4, 0xc4: 1, 0xd4: 4, 0xd5: 1, 0xd6: 2, 0xdb: 4, 0xf0: 4,
	}
	for tag, want := range cases {
		if got := tagSize(tag); got != want {
			t.Fatalf("tag 0x%02x size=%d want=%d", tag, got, want)
		}
	}
	if tagSize(0xe0) != 4 {
		t.Fatalf("cmd id size=%d", tagSize(0xe0))
	}
	if tagSize(0xe1) != -3 || tagSize(0xea) != -3 || tagSize(0xeb) != -3 {
		t.Fatalf("len-prefixed sizes e1=%d ea=%d eb=%d", tagSize(0xe1), tagSize(0xea), tagSize(0xeb))
	}
	if tagSize(0xe2) != 4 || tagSize(0xe9) != 4 {
		t.Fatalf("user data sizes e2=%d e9=%d", tagSize(0xe2), tagSize(0xe9))
	}
	if tagSize(0xfe) != -2 {
		t.Fatalf("FE size=%d", tagSize(0xfe))
	}
}

func TestParseTags_UserDataAndFE(t *testing.T) {
	// 0xE2 user.0 = 42; 0xFE len=12 with modbus0 (ext 0x01) = 100, ble0 (ext 0x21) = -5
	u := make([]byte, 4)
	binary.LittleEndian.PutUint32(u, 42)
	payload := []byte{0xe2}
	payload = append(payload, u...)
	payload = append(payload, 0xfe, 0x0c, 0x00)
	payload = append(payload, 0x01, 0x00, 0x64, 0x00, 0x00, 0x00) // ext 0x01 → modbus.0=100
	payload = append(payload, 0x21, 0x00, 0xfb, 0xff, 0xff, 0xff) // ext 0x21 → ble.0=-5
	tags := parseTags(payload)
	if len(tags[0xe2]) != 4 || binary.LittleEndian.Uint32(tags[0xe2]) != 42 {
		t.Fatalf("user e2=%x", tags[0xe2])
	}
	if len(tags[0xfe]) != 12 {
		t.Fatalf("fe len=%d", len(tags[0xfe]))
	}
	ext := parseExtendedFE(tags[0xfe])
	if ext["modbus.0"] != float64(100) {
		t.Fatalf("modbus=%v", ext)
	}
	if ext["ble.0"] != float64(-5) {
		t.Fatalf("ble=%v", ext)
	}
}

func TestLooksLikeCommandReply_UserDataNotReply(t *testing.T) {
	u := make([]byte, 4)
	binary.LittleEndian.PutUint32(u, 7)
	if looksLikeCommandReply(map[byte][]byte{0xe2: u}) {
		t.Fatal("user data alone must not look like command reply")
	}
	if !looksLikeCommandReply(map[byte][]byte{0xe1: []byte("OK")}) {
		t.Fatal("0xe1 should look like reply")
	}
}

func TestSpeedCourse_0x33(t *testing.T) {
	// Example from protocol PDF: 5C 00 48 08 → 9.2 km/h, 212°
	sc, _ := hex.DecodeString("5c004808")
	tags := map[byte][]byte{
		0x30: append([]byte{0x07}, append(make([]byte, 4), make([]byte, 4)...)...),
		0x33: sc,
	}
	fix, ok := fixFromTags(tags)
	if !ok {
		t.Fatal("expected fix")
	}
	if fix.Speed == nil || *fix.Speed < 9.1 || *fix.Speed > 9.3 {
		t.Fatalf("speed=%v", fix.Speed)
	}
	if fix.Heading == nil || *fix.Heading < 211 || *fix.Heading > 213 {
		t.Fatalf("heading=%v", fix.Heading)
	}
	if fix.RawAttrs["speed.gps"] == nil || fix.RawAttrs["heading.gps"] == nil {
		t.Fatalf("remap=%v", fix.RawAttrs)
	}
}

func TestAltitudeHDOPVoltage(t *testing.T) {
	alt := make([]byte, 2)
	binary.LittleEndian.PutUint16(alt, uint16(int16(120)))
	hdop := []byte{25} // 2.5
	pdop := []byte{30} // 3.0
	vdop := []byte{25} // 2.5
	volt := make([]byte, 2)
	binary.LittleEndian.PutUint16(volt, 12400) // 12.4 V
	coords := make([]byte, 9)
	coords[0] = 0x07 // GNSS OK + sats
	tags := map[byte][]byte{0x30: coords, 0x34: alt, 0x35: hdop, 0x36: pdop, 0x37: vdop, 0x50: volt}
	fix, ok := fixFromTags(tags)
	if !ok || fix.Altitude == nil || *fix.Altitude != 120 {
		t.Fatalf("alt ok=%v fix=%+v", ok, fix)
	}
	if fix.RawAttrs["gnss.altitude"] != 120.0 {
		t.Fatalf("alt raw=%v", fix.RawAttrs["gnss.altitude"])
	}
	if fix.RawAttrs["hdop"] != 2.5 || fix.RawAttrs["gnss.hdop"] != 2.5 {
		t.Fatalf("hdop=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["gnss.pdop"] != 3.0 || fix.RawAttrs["pdop"] != 3.0 {
		t.Fatalf("pdop=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["gnss.vdop"] != 2.5 || fix.RawAttrs["vdop"] != 2.5 {
		t.Fatalf("vdop=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["gnss.sats"] != 7 || fix.RawAttrs["gnss.fix"] != true {
		t.Fatalf("sats=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["voltage.ext"] != 12.4 {
		t.Fatalf("volt=%v", fix.RawAttrs["voltage.ext"])
	}
	if fix.RawAttrs["tag.0x50"] != 12400.0 && fix.RawAttrs["tag.0x50"] != 12400 {
		t.Fatalf("tag.0x50=%v", fix.RawAttrs["tag.0x50"])
	}
	if fix.RawAttrs["tag.0x34"] != 120.0 || fix.RawAttrs["tag.0x35"] != 2.5 {
		t.Fatalf("tag.0x34/35=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["tag.0x36"] != 3.0 || fix.RawAttrs["tag.0x37"] != 2.5 {
		t.Fatalf("tag.0x36/37=%v", fix.RawAttrs)
	}
}

func TestCRC16ModbusAndFrame(t *testing.T) {
	payload := []byte("GETVER")
	frame := buildFrame(payload)
	if frame[0] != 0x01 {
		t.Fatalf("hdr=%x", frame[0])
	}
	tagLen := int(binary.LittleEndian.Uint16(frame[1:3]))
	if tagLen != len(payload) {
		t.Fatalf("len=%d", tagLen)
	}
	withoutCRC := frame[:len(frame)-2]
	want := crc16Modbus(withoutCRC)
	got := binary.LittleEndian.Uint16(frame[len(frame)-2:])
	if got != want {
		t.Fatalf("crc got=%04x want=%04x", got, want)
	}
}

func TestEncodeDownlink_Frame(t *testing.T) {
	ad := Adapter{}
	frame, err := ad.EncodeDownlink(store.Command{PayloadText: "GETVER"})
	if err != nil {
		t.Fatal(err)
	}
	if len(frame) != 3+8+2 { // GETVER\r\n
		t.Fatalf("len=%d frame=%x", len(frame), frame)
	}
}

func TestLooksLikeCommandReply(t *testing.T) {
	if looksLikeCommandReply(map[byte][]byte{0x03: []byte("352094081234567")}) {
		t.Fatal("IMEI-only should not look like reply")
	}
	if !looksLikeCommandReply(map[byte][]byte{0xe1: {1, 2, 3, 4}}) {
		t.Fatal("0xe1 should look like reply")
	}
	if looksLikeCommandReply(map[byte][]byte{0x30: make([]byte, 9)}) {
		t.Fatal("coords-only should not look like reply")
	}
}

func TestIgnitionFromInputStatus(t *testing.T) {
	tags := map[byte][]byte{
		0x30: append([]byte{0x07}, append(make([]byte, 4), make([]byte, 4)...)...),
		0x46: {0x01, 0x00},
		0x45: {0x05, 0x00}, // outputs (official 0x45)
	}
	fix, ok := fixFromTags(tags)
	if !ok || fix.Ignition == nil || !*fix.Ignition {
		t.Fatalf("expected ignition from 0x46: %+v", fix)
	}
	if fix.RawAttrs["status.din0"] != true || fix.RawAttrs["status.ignition"] != true {
		t.Fatalf("din/ign=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.dout0"] != true || fix.RawAttrs["status.dout2"] != true {
		t.Fatalf("dout=%v", fix.RawAttrs)
	}
}

func TestDigitalIO_Din8AndInputs(t *testing.T) {
	tags := map[byte][]byte{
		0x30: append([]byte{0x07}, append(make([]byte, 4), make([]byte, 4)...)...),
		0x46: {0x02, 0x01}, // din1 + din8
		0x45: {0x02, 0x00}, // dout1
	}
	fix, ok := fixFromTags(tags)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.din1"] != true || fix.RawAttrs["status.din8"] != true {
		t.Fatalf("din1/8=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.inputs"] != 2 || fix.RawAttrs["status.inputs_hi"] != 1 {
		t.Fatalf("inputs=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["tag.0x46"] != (2|(1<<8)) || fix.RawAttrs["status.tag.0x46"] != (2|(1<<8)) {
		t.Fatalf("tag.0x46=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.dout1"] != true || fix.RawAttrs["status.outputs"] != 2 {
		t.Fatalf("dout=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["tag.0x45"] != 2 {
		t.Fatalf("tag.0x45=%v", fix.RawAttrs["tag.0x45"])
	}
}

func TestDigitalIO_Dout8AndOutputsHi(t *testing.T) {
	tags := map[byte][]byte{
		0x30: append([]byte{0x07}, append(make([]byte, 4), make([]byte, 4)...)...),
		0x45: {0x02, 0x01}, // dout1 + dout8
	}
	fix, ok := fixFromTags(tags)
	if !ok {
		t.Fatal("parse failed")
	}
	if fix.RawAttrs["status.dout1"] != true || fix.RawAttrs["status.dout8"] != true {
		t.Fatalf("dout1/8=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.outputs"] != 2 || fix.RawAttrs["status.outputs_hi"] != 1 {
		t.Fatalf("outputs=%v", fix.RawAttrs)
	}
	if fix.RawAttrs["tag.0x45"] != (2|(1<<8)) {
		t.Fatalf("tag.0x45 hi=%v", fix.RawAttrs["tag.0x45"])
	}
	tags2 := map[byte][]byte{
		0x30: append([]byte{0x07}, append(make([]byte, 4), make([]byte, 4)...)...),
		0x45: {0x00, 0x80}, // dout15
	}
	fix2, ok2 := fixFromTags(tags2)
	if !ok2 || fix2.RawAttrs["status.dout15"] != true {
		t.Fatalf("dout15=%v ok=%v", fix2.RawAttrs, ok2)
	}
}
