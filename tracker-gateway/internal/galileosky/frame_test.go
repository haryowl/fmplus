package galileosky

import (
	"encoding/binary"
	"testing"
)

func TestExtractFrames_ArchiveBitMasked(t *testing.T) {
	// High bit set (unsent archive) must not inflate the wait length — that was
	// a common cause of "first pack Reply ok, next pack no reply".
	payload := []byte{0x03, '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5'}
	frame := buildFrame(payload)
	// Force archive bit on the length field.
	dataLen := binary.LittleEndian.Uint16(frame[1:3])
	binary.LittleEndian.PutUint16(frame[1:3], dataLen|0x8000)
	// Recompute CRC over HEAD+LEN+DATA with the archive bit present.
	sum := crc16Modbus(frame[:len(frame)-2])
	binary.LittleEndian.PutUint16(frame[len(frame)-2:], sum)

	frames, rest := extractFrames(frame)
	if len(rest) != 0 {
		t.Fatalf("rest=%d", len(rest))
	}
	if len(frames) != 1 {
		t.Fatalf("frames=%d", len(frames))
	}
	if !frames[0].Archive {
		t.Fatal("expected archive flag")
	}
	if len(frames[0].Tags) != len(payload) {
		t.Fatalf("tags=%d want %d", len(frames[0].Tags), len(payload))
	}
	if frames[0].CRC != sum {
		t.Fatalf("crc=%04x want %04x", frames[0].CRC, sum)
	}
}

func TestExtractFrames_PartialWaits(t *testing.T) {
	payload := []byte{0x03, '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5'}
	frame := buildFrame(payload)
	frames, rest := extractFrames(frame[:5])
	if len(frames) != 0 || len(rest) != 5 {
		t.Fatalf("partial frames=%d rest=%d", len(frames), len(rest))
	}
	frames, rest = extractFrames(append(rest, frame[5:]...))
	if len(frames) != 1 || len(rest) != 0 {
		t.Fatalf("complete frames=%d rest=%d", len(frames), len(rest))
	}
}

func TestExtractFrames_TwoPackets(t *testing.T) {
	a := buildFrame([]byte{0x03, '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5'})
	b := buildFrame([]byte{0x20, 0x00, 0x00, 0x00, 0x01})
	frames, rest := extractFrames(append(append([]byte{}, a...), b...))
	if len(frames) != 2 || len(rest) != 0 {
		t.Fatalf("frames=%d rest=%d", len(frames), len(rest))
	}
}
