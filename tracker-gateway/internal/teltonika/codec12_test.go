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

func TestParseCodec13Response_SkipsTimestamp(t *testing.T) {
	// Wiki sample body after size: ts + "hello lets test\r\n"
	resp := []byte("hello lets test\r\n")
	payload := []byte{0x0d, 0x01, 0x06}
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(4+len(resp)))
	payload = append(payload, sz...)
	ts := make([]byte, 4)
	binary.BigEndian.PutUint32(ts, 0x64e83281)
	payload = append(payload, ts...)
	payload = append(payload, resp...)
	payload = append(payload, 0x01)
	got, ok := parseCodec12Response(payload)
	if !ok || got != string(resp) {
		t.Fatalf("got=%q ok=%v", got, ok)
	}
}

func TestParseCodec14Response_SkipsIMEI(t *testing.T) {
	resp := []byte("Ver:OK")
	imei := []byte{0x03, 0x52, 0x09, 0x30, 0x81, 0x45, 0x22, 0x51}
	payload := []byte{0x0e, 0x01, 0x06}
	sz := make([]byte, 4)
	binary.BigEndian.PutUint32(sz, uint32(8+len(resp)))
	payload = append(payload, sz...)
	payload = append(payload, imei...)
	payload = append(payload, resp...)
	payload = append(payload, 0x01)
	got, ok := parseCodec12Response(payload)
	if !ok || got != "Ver:OK" {
		t.Fatalf("got=%q ok=%v", got, ok)
	}
	nack := append([]byte{}, payload...)
	nack[2] = 0x11
	if _, ok := parseCodec12Response(nack); ok {
		t.Fatal("0x11 nACK should fail")
	}
}
