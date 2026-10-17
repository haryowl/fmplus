package galileosky

import (
	"encoding/binary"
	"fmt"
)

// parseTags walks Galileosky Easy/Main tags per official tag length table.
// Unknown tags keep an opaque remainder under 0xff so Device Manager can still see bytes.
// Duplicate tags keep the last value (single-record view).
func parseTags(payload []byte) map[byte][]byte {
	recs := parseTagRecords(payload)
	if len(recs) == 0 {
		return map[byte][]byte{}
	}
	if len(recs) == 1 {
		return recs[0]
	}
	// Merge: last record wins per tag; keep IMEI from any record.
	out := map[byte][]byte{}
	for _, r := range recs {
		for k, v := range r {
			out[k] = v
		}
	}
	return out
}

// parseTagRecords splits a packet into logical records on each 0x30 coordinate tag.
// Shared tags (e.g. 0x03 IMEI) from earlier in the stream are copied forward.
func parseTagRecords(payload []byte) []map[byte][]byte {
	type tv struct {
		id  byte
		val []byte
	}
	var flat []tv
	off := 0
	for off < len(payload) {
		tag := payload[off]
		off++
		size := tagSize(tag)
		if size < 0 {
			if off >= len(payload) {
				break
			}
			flat = append(flat, tv{0xff, append([]byte(nil), payload[off-1:]...)})
			break
		}
		if off+size > len(payload) {
			break
		}
		flat = append(flat, tv{tag, append([]byte(nil), payload[off:off+size]...)})
		off += size
	}
	if len(flat) == 0 {
		return nil
	}
	var records []map[byte][]byte
	cur := map[byte][]byte{}
	hasCoord := false
	var sharedIMEI []byte
	emit := func() {
		if !hasCoord && len(cur) == 0 {
			return
		}
		rec := map[byte][]byte{}
		for k, v := range cur {
			rec[k] = v
		}
		if _, ok := rec[0x03]; !ok && len(sharedIMEI) > 0 {
			rec[0x03] = append([]byte(nil), sharedIMEI...)
		}
		records = append(records, rec)
		cur = map[byte][]byte{}
		hasCoord = false
	}
	for _, t := range flat {
		if t.id == 0x03 {
			sharedIMEI = t.val
		}
		if t.id == 0x30 && hasCoord {
			emit()
		}
		cur[t.id] = t.val
		if t.id == 0x30 {
			hasCoord = true
		}
	}
	emit()
	if len(records) == 0 {
		return []map[byte][]byte{cur}
	}
	return records
}

func tagsToRaw(tags map[byte][]byte) map[string]any {
	m := map[string]any{}
	for k, v := range tags {
		key := fmt.Sprintf("0x%02x", k)
		if k == 0x03 && len(v) >= 15 {
			m[key] = string(v[:15])
			continue
		}
		if k == 0x30 && len(v) >= 9 {
			flags := v[0]
			m[key] = map[string]any{
				"sats":  int(flags & 0x0f),
				"valid": int(flags >> 4),
				"lat":   int32(binary.LittleEndian.Uint32(v[1:5])),
				"lon":   int32(binary.LittleEndian.Uint32(v[5:9])),
			}
			continue
		}
		if k == 0x33 && len(v) >= 4 {
			m[key] = map[string]any{
				"speed":   float64(binary.LittleEndian.Uint16(v[0:2])) / 10.0,
				"heading": float64(binary.LittleEndian.Uint16(v[2:4])) / 10.0,
			}
			continue
		}
		switch len(v) {
		case 1:
			m[key] = int(v[0])
		case 2:
			m[key] = int(binary.LittleEndian.Uint16(v))
		case 4:
			m[key] = int64(binary.LittleEndian.Uint32(v))
		case 8:
			m[key] = int64(binary.LittleEndian.Uint64(v))
		default:
			m[key] = fmt.Sprintf("%x", v)
		}
	}
	return m
}

// tagSize returns value length for known Galileosky tags (official protocol table).
// Lengths that conflicted with older heuristics are corrected here (0x04/0x10/0x33/0x46).
func tagSize(tag byte) int {
	switch tag {
	case 0x01, 0x02: // hardware / firmware version
		return 1
	case 0x03: // IMEI ASCII
		return 15
	case 0x04, 0x10: // device id / archive record number
		return 2
	case 0x20: // unix time
		return 4
	case 0x30: // coords: flags(1)+lat(4)+lon(4)
		return 9
	case 0x33: // speed + course (uint16/10 each)
		return 4
	case 0x34: // height
		return 2
	case 0x35: // HDOP
		return 1
	case 0x40, 0x41, 0x42, 0x43, 0x44, 0x45: // status bits / variants
		return 1
	case 0x46: // input status (bit per input)
		return 2
	case 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57: // analog / input values
		return 2
	case 0xd4, 0xd5, 0xd6, 0xd7: // odometer / counters
		return 4
	case 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b:
		return 4
	case 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87:
		return 8
	case 0xe1, 0xe2, 0xe3, 0xe4, 0xe5:
		return 4
	default:
		if tag >= 0x11 && tag <= 0x19 {
			return 1
		}
		if tag >= 0x21 && tag <= 0x2f {
			return 4
		}
		if tag >= 0x31 && tag <= 0x37 && tag != 0x33 {
			return 2
		}
		if tag >= 0x60 && tag <= 0x6f {
			return 4
		}
		if tag >= 0xa0 && tag <= 0xaf {
			return 4
		}
		if tag >= 0xc0 && tag <= 0xcf {
			return 4
		}
		return -1
	}
}
