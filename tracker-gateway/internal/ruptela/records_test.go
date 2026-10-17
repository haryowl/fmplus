package ruptela

import (
	"encoding/binary"
	"testing"
	"time"
)

func buildMinimalRecordPayload(extended bool) []byte {
	// records_left=0, count=1 + one GNSS header + empty IO counts
	headerLen := 23
	if extended {
		headerLen = 25
	}
	ioTail := 4 // classic n1 n2 n4 n8 zeros
	if extended {
		ioTail = 8 // four uint16 zeros
	}
	buf := make([]byte, 2+headerLen+ioTail)
	buf[0] = 0
	buf[1] = 1
	off := 2
	binary.BigEndian.PutUint32(buf[off:], uint32(time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC).Unix()))
	off += 4
	off++ // ts ext
	off++ // priority
	binary.BigEndian.PutUint32(buf[off:], uint32(int32(1068000000))) // lon ×1e7
	off += 4
	binary.BigEndian.PutUint32(buf[off:], 0xfc4e4e80) // lat −6.2 as int32 ×1e7
	off += 4
	binary.BigEndian.PutUint16(buf[off:], 120) // alt ×10
	off += 2
	binary.BigEndian.PutUint16(buf[off:], 9000) // heading ×100
	off += 2
	buf[off] = 8 // sats
	off++
	binary.BigEndian.PutUint16(buf[off:], 40) // speed
	off += 2
	buf[off] = 1 // hdop
	off++
	if extended {
		binary.BigEndian.PutUint16(buf[off:], 0)
		off += 2
	} else {
		buf[off] = 0
		off++
	}
	// empty IO counts left zero
	_ = off
	return buf
}

func TestParseRecordPayload_ProtoMsgCmd1(t *testing.T) {
	fixes := parseRecordPayload(buildMinimalRecordPayload(false), false)
	if len(fixes) != 1 {
		t.Fatalf("len=%d", len(fixes))
	}
	if fixes[0].RawAttrs["proto_msg"] != "ruptela_cmd_1" || fixes[0].RawAttrs["extended"] != false {
		t.Fatalf("%v", fixes[0].RawAttrs)
	}
	if fixes[0].RawAttrs["hdop"] != 1 || fixes[0].RawAttrs["gnss.hdop"] != 0.1 {
		t.Fatalf("hdop=%v", fixes[0].RawAttrs)
	}
}

func TestParseRecordPayload_ProtoMsgCmd68(t *testing.T) {
	fixes := parseRecordPayload(buildMinimalRecordPayload(true), true)
	if len(fixes) != 1 {
		t.Fatalf("len=%d", len(fixes))
	}
	if fixes[0].RawAttrs["proto_msg"] != "ruptela_cmd_68" || fixes[0].RawAttrs["extended"] != true {
		t.Fatalf("%v", fixes[0].RawAttrs)
	}
}
