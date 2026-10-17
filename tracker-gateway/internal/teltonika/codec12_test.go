package teltonika

import (
	"encoding/binary"
	"testing"
)

func TestParseCodec12Response_OK(t *testing.T) {
	body := []byte("IMEI:123")
	payload := []byte{0x0c, 0x01, 0x06}
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(len(body)))
	payload = append(payload, sz...)
	payload = append(payload, body...)
	payload = append(payload, 0x01)
	got, ok := parseCodec12Response(payload)
	if !ok || got != "IMEI:123" {
		t.Fatalf("got=%q ok=%v", got, ok)
	}
}

func TestParseCodec12Response_Error(t *testing.T) {
	body := []byte("ERROR: unknown")
	payload := []byte{0x0c, 0x01, 0x06}
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(len(body)))
	payload = append(payload, sz...)
	payload = append(payload, body...)
	payload = append(payload, 0x01)
	got, ok := parseCodec12Response(payload)
	if ok || got != "ERROR: unknown" {
		t.Fatalf("got=%q ok=%v", got, ok)
	}
}

func TestParseCodec12Response_Empty(t *testing.T) {
	payload := []byte{0x0c, 0x01, 0x06, 0, 0, 0, 0, 0x01}
	_, ok := parseCodec12Response(payload)
	if ok {
		t.Fatal("empty should fail")
	}
}
