package galileosky

import (
	"encoding/hex"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestParseTags_IMEIAndCoords(t *testing.T) {
	// tag 0x03 IMEI(15) + tag 0x30 coords(9)
	imei := "352094081234567"
	payload := append([]byte{0x03}, []byte(imei)...)
	coords, _ := hex.DecodeString("30" + "c0e29ac4" + "8095ada0" + "0c") // placeholder lat/lon LE + sats
	// rebuild properly
	payload = []byte{0x03}
	payload = append(payload, []byte(imei)...)
	payload = append(payload, 0x30)
	lat := make([]byte, 4)
	lon := make([]byte, 4)
	// -6.2e6 and 106.8e6 as int32 LE approx
	lat[0], lat[1], lat[2], lat[3] = 0x80, 0x69, 0xa1, 0xff // rough
	lon[0], lon[1], lon[2], lon[3] = 0x00, 0x1a, 0x5d, 0x06
	payload = append(payload, lat...)
	payload = append(payload, lon...)
	payload = append(payload, 0x0c)
	_ = coords

	tags := parseTags(payload)
	if string(tags[0x03]) != imei {
		t.Fatalf("imei tag=%q", tags[0x03])
	}
	if len(tags[0x30]) != 9 {
		t.Fatalf("coords len=%d", len(tags[0x30]))
	}
	raw := tagsToRaw(tags)
	if raw["0x03"] != imei {
		t.Fatalf("raw imei=%v", raw["0x03"])
	}
}

func TestMaybeDecompress(t *testing.T) {
	_, ok := maybeDecompress(0x01, []byte{0xE0, 0x01, 0x02})
	if !ok {
		t.Fatal("expected compressed")
	}
	_, ok = maybeDecompress(0x01, []byte{0x03, 0x01})
	if ok {
		t.Fatal("expected not compressed")
	}
}

func TestTagSize_Odometer(t *testing.T) {
	if tagSize(0xd4) != 4 {
		t.Fatalf("0xd4 size=%d", tagSize(0xd4))
	}
	payload := []byte{0xd4, 0xe8, 0x03, 0x00, 0x00} // 1000 LE
	tags := parseTags(payload)
	if len(tags[0xd4]) != 4 {
		t.Fatalf("odo tag missing: %#v", tags)
	}
}

func TestEncodeDownlink_Frame(t *testing.T) {
	ad := Adapter{}
	frame, err := ad.EncodeDownlink(storeCommand("GETVER"))
	if err != nil {
		t.Fatal(err)
	}
	if frame[0] != 0x01 {
		t.Fatalf("hdr=%x", frame[0])
	}
	if len(frame) != 3+6+1 { // hdr+len + GETVER + xor
		t.Fatalf("len=%d frame=%x", len(frame), frame)
	}
	var xor byte
	for _, b := range []byte("GETVER") {
		xor ^= b
	}
	if frame[len(frame)-1] != xor {
		t.Fatalf("checksum=%x want %x", frame[len(frame)-1], xor)
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

func storeCommand(text string) store.Command {
	return store.Command{PayloadText: text}
}
