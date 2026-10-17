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

func TestEncodeDownlink_Codec13(t *testing.T) {
	out, err := EncodeGPRS(store.Command{CommandType: "teltonika_codec13", PayloadText: "getinfo"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if out[8] != 0x0d {
		t.Fatalf("codec=%02x", out[8])
	}
	// size field at [11:15] should be 4+7=11
	if out[11] != 0 || out[12] != 0 || out[13] != 0 || out[14] != 11 {
		t.Fatalf("size bytes %x", out[11:15])
	}
}

func TestEncodeDownlink_Codec14_IMEI(t *testing.T) {
	out, err := EncodeGPRS(store.Command{CommandType: "teltonika_codec14", PayloadText: "getinfo"}, "352093081452251")
	if err != nil {
		t.Fatal(err)
	}
	// preamble + len + 0x0E ...
	if out[8] != 0x0e {
		t.Fatalf("codec=%02x", out[8])
	}
	imei, err := imeiToCodec14("352093081452251")
	if err != nil {
		t.Fatal(err)
	}
	want := []byte{0x03, 0x52, 0x09, 0x30, 0x81, 0x45, 0x22, 0x51}
	if string(imei) != string(want) {
		t.Fatalf("imei=%x want=%x", imei, want)
	}
	_, err = EncodeGPRS(store.Command{CommandType: "teltonika_codec14", PayloadText: "x"}, "")
	if err == nil {
		t.Fatal("expected IMEI required")
	}
}

func TestCRC16IBM_Codec12Payload(t *testing.T) {
	// AVL array only (no preamble/len/crc): 0C 01 05 00 00 00 07 getinfo 01
	avl, _ := hex.DecodeString("0c010500000007676574696e666f01")
	if crc16IBM(avl) != 0x4312 {
		t.Fatalf("crc=%04x want 4312", crc16IBM(avl))
	}
}
