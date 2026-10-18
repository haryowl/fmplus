package jt809

import (
	"encoding/binary"
	"testing"
)

func TestCRC16CCITTFalse_Known(t *testing.T) {
	// Empty → 0xFFFF
	if crc16CCITTFalse(nil) != 0xFFFF {
		t.Fatalf("%04x", crc16CCITTFalse(nil))
	}
}

func TestEscapeUnescapeRoundTrip(t *testing.T) {
	raw := []byte{0x00, 0x5b, 0x5a, 0x5d, 0x5e, 0x01}
	got := unescape809(escape809(raw))
	if string(got) != string(raw) {
		t.Fatalf("%x != %x", got, raw)
	}
}

func TestTakeFrame809_RoundTrip(t *testing.T) {
	body := make([]byte, 22)
	binary.BigEndian.PutUint32(body[0:4], 22)
	binary.BigEndian.PutUint16(body[8:10], 0x1005)
	frame := wrapFrame809(body)
	payload, rest, ok, crcFail := takeFrame809(frame)
	if !ok || crcFail || len(rest) != 0 {
		t.Fatalf("ok=%v crcFail=%v rest=%d", ok, crcFail, len(rest))
	}
	if binary.BigEndian.Uint16(payload[8:10]) != 0x1005 {
		t.Fatalf("%x", payload)
	}
}

func TestTakeFrame809_BadCRC(t *testing.T) {
	body := make([]byte, 22)
	frame := wrapFrame809(body)
	// Corrupt a middle byte (after 0x5B).
	if len(frame) > 4 {
		frame[3] ^= 0xff
	}
	_, _, ok, crcFail := takeFrame809(frame)
	if ok || !crcFail {
		t.Fatalf("expected CRC fail ok=%v crcFail=%v", ok, crcFail)
	}
}
