package galileosky

import (
	"encoding/binary"
	"fmt"
	"strings"
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
		if size == -3 {
			// 1-byte length + payload (command reply tags 0xE0–0xE6).
			if off >= len(payload) {
				break
			}
			n := int(payload[off])
			off++
			if n < 0 || off+n > len(payload) {
				break
			}
			flat = append(flat, tv{tag, append([]byte(nil), payload[off:off+n]...)})
			off += n
			continue
		}
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
		if k >= 0xe0 && k <= 0xe6 {
			s := strings.TrimSpace(string(v))
			if s != "" {
				m[key] = s
				continue
			}
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

// tagSize returns value length for known Galileosky tags per official protocol table
// ("Описание протокола обмена с сервером", §8). Unknown → -1 (opaque remainder under 0xff).
// Command-channel replies 0xE0–0xE6 use 1-byte length prefix (−3).
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
	case 0x34: // height (int16)
		return 2
	case 0x35: // HDOP (/10) or LBS error (×10)
		return 1
	case 0x40: // device status bitfield
		return 2
	case 0x41, 0x42: // supply / battery voltage mV
		return 2
	case 0x43: // terminal temperature °C (int8)
		return 1
	case 0x44: // acceleration XYZ packed 10-bit
		return 4
	case 0x45: // output status bits
		return 2
	case 0x46: // input status bits
		return 2
	case 0x47: // EcoDrive (accel/brake/turn/bump)
		return 4
	case 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57: // input 0–7 values
		return 2
	case 0x58, 0x59: // RS232 0/1
		return 2
	case 0x5a: // REP-500 energy counter
		return 4
	case 0x5d: // DBG-S11D dosimeter
		return 3
	case 0x60, 0x61, 0x62: // RS485 DUT 0–2
		return 2
	case 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f:
		// RS485 DUT 3–15: fuel uint16 + temp int8
		return 3
	case 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77: // thermometer id + temp
		return 2
	case 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87: // DS1923 id+temp+humidity
		return 3
	case 0x88, 0x8a, 0x8b, 0x8c: // DUT temp / weight (int8)
		return 1
	case 0x90, 0xd3: // iButton id 0 / 1
		return 4
	case 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf:
		return 1 // CAN8BITR15–30
	case 0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9:
		return 2 // CAN16BITR5–14
	case 0xc0, 0xc1, 0xc2, 0xc3: // CAN_A0/A1/B0/B1
		return 4
	case 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf:
		return 1 // CAN8BITR0–11
	case 0xd0, 0xd1, 0xd2: // CAN8BITR12–14
		return 1
	case 0xd4: // GPS/GLONASS odometer m
		return 4
	case 0xd5: // iButton attached bitmask
		return 1
	case 0xd6, 0xd7, 0xd8, 0xd9, 0xda: // CAN16BITR / axle / OBD
		return 2
	case 0xdb, 0xdc, 0xdd, 0xde, 0xdf: // CAN32BITR / engine hours / fuel L
		return 4
	case 0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6:
		// Length-prefixed command/text reply (1-byte len + ASCII/data).
		return -3
	case 0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9:
		return 4 // CAN32BITR5–14
	default:
		return -1
	}
}
