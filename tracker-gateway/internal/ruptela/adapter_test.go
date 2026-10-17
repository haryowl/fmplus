package ruptela

import (
	"encoding/binary"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestEncodeDownlink_SMS108(t *testing.T) {
	a := Adapter{}
	out, err := a.EncodeDownlink(store.Command{PayloadText: "setio 2,1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) < 5 {
		t.Fatalf("short frame %x", out)
	}
	plen := int(binary.BigEndian.Uint16(out[0:2]))
	if plen != 1+len("setio 2,1") {
		t.Fatalf("len=%d", plen)
	}
	if out[2] != 0x6c {
		t.Fatalf("cmd=%x want 0x6c", out[2])
	}
	if string(out[3:3+plen-1]) != "setio 2,1" {
		t.Fatalf("payload=%q", out[3:3+plen-1])
	}
	// CRC must match same algorithm used by record ACKs.
	wantCRC := crc16IBM(out[:2+plen])
	gotCRC := binary.BigEndian.Uint16(out[2+plen:])
	if gotCRC != wantCRC {
		t.Fatalf("crc=%04x want %04x", gotCRC, wantCRC)
	}
}
