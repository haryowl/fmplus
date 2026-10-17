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

func TestTagSize_Official(t *testing.T) {
	if tagSize(0x01) != 1 || tagSize(0x04) != 2 || tagSize(0x33) != 4 || tagSize(0x46) != 2 {
		t.Fatalf("sizes hw=%d id=%d spd=%d in=%d", tagSize(0x01), tagSize(0x04), tagSize(0x33), tagSize(0x46))
	}
	if tagSize(0xd4) != 4 {
		t.Fatalf("0xd4 size=%d", tagSize(0xd4))
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
	if len(frame) != 3+6+2 {
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
	}
	fix, ok := fixFromTags(tags)
	if !ok || fix.Ignition == nil || !*fix.Ignition {
		t.Fatalf("expected ignition from 0x46: %+v", fix)
	}
}
