package galileosky

import (
	"encoding/binary"
	"fmt"
)

// parseTags walks Galileosky Easy/Main tags; unknown tags attempt safe skip via tagSize.
func parseTags(payload []byte) map[byte][]byte {
	out := make(map[byte][]byte)
	off := 0
	for off < len(payload) {
		tag := payload[off]
		off++
		size := tagSize(tag)
		if size < 0 {
			// compressed / unknown — stop to avoid desync
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
		if len(v) <= 8 {
			switch len(v) {
			case 1:
				m[key] = int(v[0])
			case 2:
				m[key] = int(binary.LittleEndian.Uint16(v))
			case 4:
				m[key] = int64(binary.LittleEndian.Uint32(v))
			default:
				m[key] = fmt.Sprintf("%x", v)
			}
		} else {
			m[key] = fmt.Sprintf("%x", v)
		}
	}
	return m
}

// maybeDecompress handles Galileosky compressed header 0x01 with compression flag in some firmwares.
// Returns uncompressed payload or original if not compressed / unsupported.
func maybeDecompress(hdr0 byte, body []byte) (payload []byte, compressed bool) {
	if len(body) < 2 {
		return body, false
	}
	// Some devices use first tag 0xE0/0xE1 as compression marker — experimental.
	if body[0] == 0xE0 || body[0] == 0xE1 {
		// Not a full zlib decoder yet — stash as opaque and skip tag walk.
		return body, true
	}
	_ = hdr0
	return body, false
}
