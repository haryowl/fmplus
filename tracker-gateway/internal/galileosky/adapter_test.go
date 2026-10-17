package galileosky

import (
	"encoding/binary"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestEncodeDownlink_textFrame(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{CommandType: "galileosky_text", PayloadText: "GETVER"})
	if err != nil {
		t.Fatal(err)
	}
	// "GETVER\r\n" = 8 bytes payload
	if len(out) != 3+8+2 {
		t.Fatalf("len=%d (expected CRLF append) frame=%x", len(out), out)
	}
}

func TestEncodeDownlink_textFrame_PreservesCRLF(t *testing.T) {
	ad := Adapter{}
	out, err := ad.EncodeDownlink(store.Command{PayloadText: "GETVER\r\n"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) < 5 || out[0] != 0x01 {
		t.Fatalf("frame=%x", out)
	}
	plen := binary.LittleEndian.Uint16(out[1:3])
	if int(plen) != len("GETVER\r\n") {
		t.Fatalf("len=%d (should not double-append CRLF)", plen)
	}
	wantCRC := crc16Modbus(out[:len(out)-2])
	gotCRC := binary.LittleEndian.Uint16(out[len(out)-2:])
	if wantCRC != gotCRC {
		t.Fatalf("crc want=%04x got=%04x", wantCRC, gotCRC)
	}
}

func TestEncodeDownlink_empty(t *testing.T) {
	ad := Adapter{}
	if _, err := ad.EncodeDownlink(store.Command{}); err == nil {
		t.Fatal("expected error")
	}
}
