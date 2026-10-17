package teltonika

import (
	"encoding/hex"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// Golden Codec12 frames from https://wiki.teltonika-gps.com/view/Codec#Codec_12
func TestEncodeDownlink_Codec12_Getinfo(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{PayloadText: "getinfo"})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := hex.DecodeString("000000000000000f0c010500000007676574696e666f0100004312")
	if hex.EncodeToString(out) != hex.EncodeToString(want) {
		t.Fatalf("got %x\nwant %x", out, want)
	}
}

func TestEncodeDownlink_Codec12_Getio(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{PayloadText: "getio"})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := hex.DecodeString("000000000000000d0c010500000005676574696f01000000cb")
	if hex.EncodeToString(out) != hex.EncodeToString(want) {
		t.Fatalf("got %x\nwant %x", out, want)
	}
}

func TestCRC16IBM_Codec12Payload(t *testing.T) {
	// AVL array only (no preamble/len/crc): 0C 01 05 00 00 00 07 getinfo 01
	avl, _ := hex.DecodeString("0c010500000007676574696e666f01")
	if crc16IBM(avl) != 0x4312 {
		t.Fatalf("crc=%04x want 4312", crc16IBM(avl))
	}
}
