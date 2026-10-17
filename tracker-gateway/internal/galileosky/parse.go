package galileosky

import (
	"encoding/binary"
	"fmt"
)

// parseTags walks Galileosky Easy/Main tags. Unknown tags use a heuristic size
// table so the walk continues when possible instead of stopping cold.
func parseTags(payload []byte) map[byte][]byte {
	out := make(map[byte][]byte)
	off := 0
	for off < len(payload) {
		tag := payload[off]
		off++
		size := tagSize(tag)
		if size < 0 {
			// last-resort: try 1-byte then 2/4 if remaining is short
			if off >= len(payload) {
				break
			}
			// Keep opaque remainder under synthetic key so Device Manager can see it.
			out[0xff] = append([]byte(nil), payload[off-1:]...)
			break
		}
		if off+size > len(payload) {
			break
		}
		out[tag] = append([]byte(nil), payload[off:off+size]...)
		off += size
	}
	return out
}

func tagsToRaw(tags map[byte][]byte) map[string]any {
	m := map[string]any{}
	for k, v := range tags {
		key := fmt.Sprintf("0x%02x", k)
		if k == 0x03 && len(v) >= 15 {
			m[key] = string(v[:15])
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
		case 9:
			// coords blob
			m[key] = map[string]any{
				"lat":  int32(binary.LittleEndian.Uint32(v[0:4])),
				"lon":  int32(binary.LittleEndian.Uint32(v[4:8])),
				"sats": int(v[8]),
			}
		default:
			m[key] = fmt.Sprintf("%x", v)
		}
	}
	return m
}

// maybeDecompress detects Galileosky compressed markers (experimental).
func maybeDecompress(hdr0 byte, body []byte) (payload []byte, compressed bool) {
	if len(body) < 1 {
		return body, false
	}
	// 0xE0 / 0xE1 appear as compression markers on some firmwares.
	if body[0] == 0xE0 || body[0] == 0xE1 {
		return body, true
	}
	_ = hdr0
	return body, false
}

func tagSize(tag byte) int {
	switch tag {
	case 0x01, 0x02, 0x04, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
		0x18, 0x19, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49:
		return 1
	case 0x20, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59:
		return 2
	case 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b,
		0x2c, 0x2d, 0x2e, 0x2f, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0xe1:
		return 4
	case 0x30:
		return 9
	case 0x03:
		return 15
	case 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b:
		return 4
	case 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87:
		return 8
	case 0xd4, 0xd5, 0xd6, 0xd7: // odometer / counters (model-dependent)
		return 4
	case 0xe2, 0xe3, 0xe4, 0xe5:
		return 4
	default:
		if tag >= 0x50 && tag <= 0x57 {
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
