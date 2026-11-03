package galileosky

import (
	"encoding/binary"
	"testing"
)

func TestWriteAckHdr_EchoesDeviceCRC(t *testing.T) {
	// Device confirmations must echo the packet CRC bytes (LinuxOHW / protocol).
	conn := &memConn{}
	crc := uint16(0xFA3F)
	if err := writeAckHdr(conn, 0x02, crc); err != nil {
		t.Fatal(err)
	}
	if len(conn.out) != 3 || conn.out[0] != 0x02 {
		t.Fatalf("ack=%x", conn.out)
	}
	if binary.LittleEndian.Uint16(conn.out[1:3]) != crc {
		t.Fatalf("crc=%x", conn.out[1:3])
	}
	conn.out = nil
	if err := writeAckHdr(conn, 0x07, crc); err != nil {
		t.Fatal(err)
	}
	if conn.out[0] != 0x07 {
		t.Fatalf("photo ack hdr=%x", conn.out[0])
	}
}

func TestApplyPacketMeta_ArchiveAndCount(t *testing.T) {
	raw := map[string]any{}
	applyPacketMeta(raw, true, 1)
	if raw["archive"] != true || raw["record_count"] != nil {
		t.Fatalf("archive only=%v", raw)
	}
	raw2 := map[string]any{}
	applyPacketMeta(raw2, false, 3)
	if raw2["archive"] != nil || raw2["record_count"] != 3 {
		t.Fatalf("count only=%v", raw2)
	}
	raw3 := map[string]any{}
	applyPacketMeta(raw3, true, 2)
	if raw3["archive"] != true || raw3["record_count"] != 2 {
		t.Fatalf("both=%v", raw3)
	}
	applyPacketMeta(nil, true, 2) // no panic
}
