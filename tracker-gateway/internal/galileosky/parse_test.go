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

func unixLE(sec uint32) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, sec)
	return b
}

func TestParseTagRecords_CoordsThenDeviceTime(t *testing.T) {
	// Real devices often emit 0x30 then 0x20 in the same row. Splitting on the
	// first 0x20 after coords used to leave row 1 with no time.
	coords, _ := hex.DecodeString("07c00e3203b8d72d05")
	payload := []byte{0x30}
	payload = append(payload, coords...)
	payload = append(payload, 0x20)
	payload = append(payload, unixLE(1_700_000_000)...)
	payload = append(payload, 0x30)
	payload = append(payload, coords...)
	payload = append(payload, 0x20)
	payload = append(payload, unixLE(1_700_000_060)...)
	recs := parseTagRecords(payload)
	if len(recs) != 2 {
		t.Fatalf("recs=%d", len(recs))
	}
	t0, ok0 := deviceTimeFromTags(recs[0])
	t1, ok1 := deviceTimeFromTags(recs[1])
	if !ok0 || !ok1 {
		t.Fatalf("0x20 missing: %v / %v", recs[0][0x20], recs[1][0x20])
	}
	if t0.Unix() != 1_700_000_000 || t1.Unix() != 1_700_000_060 {
		t.Fatalf("times %v / %v", t0, t1)
	}
}

func TestParseTagRecords_ArchiveRows(t *testing.T) {
	coords, _ := hex.DecodeString("07c00e3203b8d72d05")
	row := func(n uint16, unix uint32) []byte {
		idx := make([]byte, 2)
		binary.LittleEndian.PutUint16(idx, n)
		p := []byte{0x10}
		p = append(p, idx...)
		p = append(p, 0x20)
		p = append(p, unixLE(unix)...)
		p = append(p, 0x30)
		p = append(p, coords...)
		return p
	}
	payload := append(row(10, 1_700_000_000), row(11, 1_700_000_030)...)
	recs := parseTagRecords(payload)
	if len(recs) != 2 {
		t.Fatalf("recs=%d", len(recs))
	}
	t0, _ := deviceTimeFromTags(recs[0])
	t1, _ := deviceTimeFromTags(recs[1])
	if t0.Unix() != 1_700_000_000 || t1.Unix() != 1_700_000_030 {
		t.Fatalf("times %v / %v", t0, t1)
	}
	if binary.LittleEndian.Uint16(recs[0][0x10]) != 10 || binary.LittleEndian.Uint16(recs[1][0x10]) != 11 {
		t.Fatalf("archive index")
	}
}

func TestParseTagRecords_PerPointDeviceTime(t *testing.T) {
	coords, _ := hex.DecodeString("07c00e3203b8d72d05")
	payload := []byte{0x20}
	payload = append(payload, unixLE(1_700_000_000)...)
	payload = append(payload, 0x30)
	payload = append(payload, coords...)
	payload = append(payload, 0x20)
	payload = append(payload, unixLE(1_700_000_060)...)
	payload = append(payload, 0x30)
	payload = append(payload, coords...)
	recs := parseTagRecords(payload)
	if len(recs) != 2 {
		t.Fatalf("recs=%d", len(recs))
	}
	t0, _ := deviceTimeFromTags(recs[0])
	t1, _ := deviceTimeFromTags(recs[1])
	if t0.Unix() != 1_700_000_000 || t1.Unix() != 1_700_000_060 {
		t.Fatalf("times %v / %v", t0, t1)
	}
}

func TestFixFromTags_NoServerNowFallback(t *testing.T) {
	coords, _ := hex.DecodeString("07c00e3203b8d72d05")
	fix, ok := fixFromTags(map[byte][]byte{0x30: coords})
	if !ok {
		t.Fatal("expected fix")
	}
	if !fix.RecordedAt.IsZero() {
		t.Fatalf("missing 0x20 must not stamp server now: %v", fix.RecordedAt)
	}
}

func TestFixFromTags_LBSNotMapValid(t *testing.T) {
	coords, _ := hex.DecodeString("27c00e3203b8d72d05") // nibble 2 = LBS
	fix, ok := fixFromTags(map[byte][]byte{
		0x20: unixLE(1_700_000_000),
		0x30: coords,
	})
	if !ok {
		t.Fatal("expected fix")
	}
	if fix.RawAttrs["gps.valid"] != false {
		t.Fatalf("LBS must not be gps.valid: %v", fix.RawAttrs)
	}
	if fix.RawAttrs["gnss.lbs"] != true {
		t.Fatalf("expected gnss.lbs: %v", fix.RawAttrs)
	}
	if fix.Lat == 0 && fix.Lon == 0 {
		t.Fatal("LBS coords should be kept for Terminal")
	}
}

func TestParseTags_LiveValuesPacket_0x21Ms(t *testing.T) {
	// Production Live values blob after 0x20: unknown 0x21 previously swallowed
	// the rest into tag.0xff. With official 0x21=2 (ms), the stream must expose
	// 0x30…0xFE as separate cooked tags.
	payload, err := hex.DecodeString(
		"211500" + // 0x21 ms=21
			"30100000000000000000" + // 0x30 invalid GPS (nibble=1), lat=0,lon=0
			"3300000000" + // speed/course 0
			"340000" + // altitude 0
			"35e7" + // HDOP 23.1
			"40480a" + // status
			"413c5c" + // supply mV
			"42420f" + // batt mV
			"460000" + // inputs
			"500000" + // ain0
			"510000" + // ain1
			"e200000000" +
			"e300000000" +
			"e400000000" +
			"e500000000" +
			"e600000000" +
			"fe0600010000000000",
	)
	if err != nil {
		t.Fatal(err)
	}
	tags := parseTags(payload)
	if _, bad := tags[0xff]; bad {
		t.Fatalf("0xff opaque dump must not appear: %v", tags)
	}
	if len(tags[0x21]) != 2 || binary.LittleEndian.Uint16(tags[0x21]) != 21 {
		t.Fatalf("0x21 ms=%x", tags[0x21])
	}
	if len(tags[0x30]) != 9 {
		t.Fatalf("0x30 len=%d", len(tags[0x30]))
	}
	if len(tags[0x41]) != 2 || len(tags[0x42]) != 2 {
		t.Fatalf("volt tags missing: %v", tags)
	}
	if len(tags[0xfe]) != 6 {
		t.Fatalf("fe len=%d", len(tags[0xfe]))
	}
	fix, ok := fixFromTags(tags)
	if !ok {
		t.Fatal("expected fix from 0x30")
	}
	if fix.RawAttrs["gps.valid"] != false {
		t.Fatalf("gps.valid=%v", fix.RawAttrs["gps.valid"])
	}
	if fix.RawAttrs["time.ms"] != 21 {
		t.Fatalf("time.ms=%v", fix.RawAttrs["time.ms"])
	}
	if fix.RawAttrs["gnss.hdop"] != 23.1 {
		t.Fatalf("hdop=%v", fix.RawAttrs["gnss.hdop"])
	}
	// Cooked volts (not raw mV) on app-param keys.
	supplyMV := float64(binary.LittleEndian.Uint16(tags[0x41]))
	if fix.RawAttrs["voltage.supply"] != supplyMV/1000.0 {
		t.Fatalf("voltage.supply=%v want %v", fix.RawAttrs["voltage.supply"], supplyMV/1000.0)
	}
	promoteSensorTags(fix.RawAttrs, tags)
	if fix.RawAttrs["user.0"] != float64(0) {
		t.Fatalf("user.0=%v", fix.RawAttrs["user.0"])
	}
	if fix.RawAttrs["modbus.0"] != float64(0) {
		t.Fatalf("modbus=%v", fix.RawAttrs)
	}
}

func TestTagSize_Official(t *testing.T) {
	cases := map[byte]int{
		0x01: 1, 0x03: 15, 0x04: 2, 0x10: 2, 0x20: 4, 0x21: 2, 0x30: 9, 0x33: 4, 0x34: 2, 0x35: 1,
		0x5b: 7,
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
	// 0xE2 user.0 = 42; 0xFE len=18 = 3×(u16+i32):
	//   Modbus0 (ext 0x01)=100, Modbus63 (ext 0x80)=-1, ble0 (ext 0x21)=-5
	u := make([]byte, 4)
	binary.LittleEndian.PutUint32(u, 42)
	payload := []byte{0xe2}
	payload = append(payload, u...)
	payload = append(payload, 0xfe, 0x12, 0x00) // 18 bytes nested
	payload = append(payload, 0x01, 0x00, 0x64, 0x00, 0x00, 0x00) // Modbus0
	payload = append(payload, 0x80, 0x00, 0xff, 0xff, 0xff, 0xff) // Modbus63 = -1
	payload = append(payload, 0x21, 0x00, 0xfb, 0xff, 0xff, 0xff) // Bluetooth0
	tags := parseTags(payload)
	if len(tags[0xe2]) != 4 || binary.LittleEndian.Uint32(tags[0xe2]) != 42 {
		t.Fatalf("user e2=%x", tags[0xe2])
	}
	if len(tags[0xfe]) != 18 {
		t.Fatalf("fe len=%d want 18 (3×6)", len(tags[0xfe]))
	}
	if tagSize(0xfe) != -2 {
		t.Fatalf("0xFE must be 2-byte length-prefixed, got %d", tagSize(0xfe))
	}
	if tagSize(0x80) != 3 {
		t.Fatalf("main 0x80 is DS1923 3 bytes, not Modbus; got %d", tagSize(0x80))
	}
	ext := parseExtendedFE(tags[0xfe])
	if ext["modbus.0"] != float64(100) {
		t.Fatalf("modbus.0=%v", ext)
	}
	if ext["modbus.63"] != float64(-1) {
		t.Fatalf("modbus.63=%v", ext)
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
	coords, _ := hex.DecodeString("07c00e3203b8d72d05") // GNSS OK + sats, valid lat/lon
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

func TestInputStatusDin0_NoAssumedIgnition(t *testing.T) {
	tags := map[byte][]byte{
		0x30: append([]byte{0x07}, append(make([]byte, 4), make([]byte, 4)...)...),
		0x46: {0x01, 0x00},
		0x45: {0x05, 0x00}, // outputs (official 0x45)
	}
	fix, ok := fixFromTags(tags)
	if !ok {
		t.Fatalf("parse failed: %+v", fix)
	}
	if fix.Ignition != nil {
		t.Fatalf("ignition must be user-mapped, got %+v", fix.Ignition)
	}
	if _, ok := fix.RawAttrs["status.ignition"]; ok {
		t.Fatalf("status.ignition must not be assumed: %v", fix.RawAttrs)
	}
	if fix.RawAttrs["status.din0"] != true {
		t.Fatalf("din0=%v", fix.RawAttrs)
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
