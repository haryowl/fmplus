package ruptela

import (
	"encoding/binary"
	"encoding/hex"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestCRC16Kermit_AckGolden(t *testing.T) {
	// Official: 00 02 | 64 01 | 13 BC  — CRC over payload 64 01 only
	if crc16Kermit([]byte{0x64, 0x01}) != 0x13bc {
		t.Fatalf("ack crc=%04x want 13bc", crc16Kermit([]byte{0x64, 0x01}))
	}
}

func TestCRC16Kermit_SMS108Golden(t *testing.T) {
	// Official example: 000B 6C 20 53 65 74 69 6F 20 32 2C 31 EB3E  (" Setio 2,1")
	body, _ := hex.DecodeString("6c20536574696f20322c31")
	if crc16Kermit(body) != 0xeb3e {
		t.Fatalf("sms crc=%04x want eb3e", crc16Kermit(body))
	}
}

func TestEncodeDownlink_SMS108_Golden(t *testing.T) {
	a := Adapter{}
	out, err := a.EncodeDownlink(store.Command{PayloadText: " Setio 2,1"})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := hex.DecodeString("000b6c20536574696f20322c31eb3e")
	if hex.EncodeToString(out) != hex.EncodeToString(want) {
		t.Fatalf("got %x\nwant %x", out, want)
	}
}

func TestEncodeDownlink_Cmd105(t *testing.T) {
	a := Adapter{}
	out, err := a.EncodeDownlink(store.Command{CommandType: "ruptela_105", PayloadText: "get"})
	if err != nil {
		t.Fatal(err)
	}
	if out[2] != 105 {
		t.Fatalf("cmd=%d want 105 frame=%x", out[2], out)
	}
	if DownlinkCorrID("ruptela_107") != "107" || DownlinkCorrID("ruptela_sms") != "108" {
		t.Fatal("corr")
	}
}

func TestWriteRecordsAck_Frame(t *testing.T) {
	// Build expected bytes without socket.
	body := []byte{0x64, 0x01}
	crc := crc16Kermit(body)
	out := []byte{0x00, 0x02, 0x64, 0x01, byte(crc >> 8), byte(crc)}
	if binary.BigEndian.Uint16(out[4:6]) != 0x13bc {
		t.Fatalf("ack frame=%x", out)
	}
}

func TestDissectPacket_IMEIFirst(t *testing.T) {
	// IMEI 8 bytes + cmd 1 + left + count
	data := make([]byte, 11)
	binary.BigEndian.PutUint64(data[0:8], 12207001062170)
	data[8] = 1
	data[9] = 0
	data[10] = 1
	cmd, imei, rest := dissectPacket(data)
	if cmd != 1 || imei != "12207001062170" || len(rest) != 2 {
		t.Fatalf("cmd=%d imei=%s rest=%x", cmd, imei, rest)
	}
}
