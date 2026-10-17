package galileosky

import (
	"encoding/hex"
	"testing"
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
