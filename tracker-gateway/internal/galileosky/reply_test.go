package galileosky

import (
	"encoding/binary"
	"strings"
	"testing"
)

func TestFormatCommandReply_Text(t *testing.T) {
	tags := map[byte][]byte{0xe1: []byte("Soft=1.2")}
	text, ok := formatCommandReply(tags)
	if !ok || text != "Soft=1.2" {
		t.Fatalf("%q ok=%v", text, ok)
	}
}

func TestFormatCommandReply_Error(t *testing.T) {
	tags := map[byte][]byte{0xe1: []byte("ERROR: unknown")}
	text, ok := formatCommandReply(tags)
	if ok || text != "ERROR: unknown" {
		t.Fatalf("%q ok=%v", text, ok)
	}
}

func TestFormatCommandReply_IgnoresUserData(t *testing.T) {
	u := make([]byte, 4)
	binary.LittleEndian.PutUint32(u, 99)
	tags := map[byte][]byte{0xe6: u}
	text, ok := formatCommandReply(tags)
	if !ok || strings.Contains(text, "ERROR") {
		t.Fatalf("user tag must not be cmd text: %q ok=%v", text, ok)
	}
}

func TestParseTagRecords_LengthPrefixedE1(t *testing.T) {
	// tag e1, len=5, "HELLO"
	payload := []byte{0xe1, 0x05, 'H', 'E', 'L', 'L', 'O'}
	recs := parseTagRecords(payload)
	if len(recs) != 1 || string(recs[0][0xe1]) != "HELLO" {
		t.Fatalf("%v", recs)
	}
}
