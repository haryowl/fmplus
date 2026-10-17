package jt808

import (
	"encoding/binary"
	"testing"
)

func TestSubpkgFeed_Reassembles(t *testing.T) {
	tr := newSubpkgTracker()
	a := []byte{0x01, 0x02}
	b := []byte{0x03, 0x04, 0x05}
	if _, ok := tr.feed("13800138000", 0x0200, 2, 1, a); ok {
		t.Fatal("early complete")
	}
	full, ok := tr.feed("13800138000", 0x0200, 2, 2, b)
	if !ok {
		t.Fatal("expected complete")
	}
	if string(full) != string(append(a, b...)) {
		t.Fatalf("full=%x", full)
	}
}

func TestSubpkgFeed_OutOfOrder(t *testing.T) {
	tr := newSubpkgTracker()
	_, _ = tr.feed("1", 0x0704, 3, 3, []byte{0x33})
	_, _ = tr.feed("1", 0x0704, 3, 1, []byte{0x11})
	full, ok := tr.feed("1", 0x0704, 3, 2, []byte{0x22})
	if !ok || string(full) != "\x11\x22\x33" {
		t.Fatalf("full=%x ok=%v", full, ok)
	}
}

func TestHandleFrame_SubpackageBit(t *testing.T) {
	// Build two escaped frames that together form a short 0x0002 heartbeat body.
	// Heartbeat has empty body — use 0x0002 with empty body split is awkward;
	// instead verify header parse helpers via feed + props bit.
	props := uint16(0x2000 | 2) // subpackage + body len 2
	header := make([]byte, 16)
	binary.BigEndian.PutUint16(header[0:2], 0x0200)
	binary.BigEndian.PutUint16(header[2:4], props)
	// phone 013800138000 BCD
	phone := "013800138000"
	for i := 0; i < 6; i++ {
		hi := phone[i*2] - '0'
		lo := phone[i*2+1] - '0'
		header[4+i] = (hi << 4) | lo
	}
	binary.BigEndian.PutUint16(header[10:12], 1)
	binary.BigEndian.PutUint16(header[12:14], 2) // total
	binary.BigEndian.PutUint16(header[14:16], 1) // index
	frag := []byte{0xaa, 0xbb}
	msg := append(header, frag...)
	msg = append(msg, bcc(msg))
	framed := escape(msg)

	raw := unescape(framed)
	m := raw[:len(raw)-1]
	bodyProps := binary.BigEndian.Uint16(m[2:4])
	if bodyProps&0x2000 == 0 {
		t.Fatal("missing subpackage bit")
	}
	total := int(binary.BigEndian.Uint16(m[12:14]))
	idx := int(binary.BigEndian.Uint16(m[14:16]))
	bodyLen := int(bodyProps & 0x3ff)
	body := m[16 : 16+bodyLen]
	tr := newSubpkgTracker()
	if _, ok := tr.feed(bcdPhone(m[4:10]), 0x0200, total, idx, body); ok {
		t.Fatal("should wait for part 2")
	}
	header2 := append([]byte{}, header...)
	binary.BigEndian.PutUint16(header2[10:12], 2)
	binary.BigEndian.PutUint16(header2[14:16], 2)
	frag2 := []byte{0xcc, 0xdd}
	msg2 := append(header2, frag2...)
	msg2 = append(msg2, bcc(msg2))
	m2 := unescape(escape(msg2))
	m2 = m2[:len(m2)-1]
	full, ok := tr.feed(bcdPhone(m2[4:10]), 0x0200, 2, 2, m2[16:18])
	if !ok || string(full) != "\xaa\xbb\xcc\xdd" {
		t.Fatalf("full=%x ok=%v", full, ok)
	}
}
