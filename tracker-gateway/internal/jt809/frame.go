package jt809

import (
	"encoding/binary"

	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
)

// crc16CCITTFalse is CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) used by JT/T 809.
func crc16CCITTFalse(data []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, b := range data {
		crc ^= uint16(b) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = (crc << 1) ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

// unescape809 reverses JT809 wire escapes (5A01→5B, 5A02→5A, 5E01→5D, 5E02→5E).
func unescape809(esc []byte) []byte {
	out := make([]byte, 0, len(esc))
	for i := 0; i < len(esc); i++ {
		if i+1 < len(esc) {
			if esc[i] == 0x5a {
				switch esc[i+1] {
				case 0x01:
					out = append(out, 0x5b)
					i++
					continue
				case 0x02:
					out = append(out, 0x5a)
					i++
					continue
				}
			}
			if esc[i] == 0x5e {
				switch esc[i+1] {
				case 0x01:
					out = append(out, 0x5d)
					i++
					continue
				case 0x02:
					out = append(out, 0x5e)
					i++
					continue
				}
			}
		}
		out = append(out, esc[i])
	}
	return out
}

// takeFrame809 extracts one 0x5B … 0x5D frame from a stream buffer.
// Returns unescaped header+body (CRC stripped), remaining buffer, ok, and crcFail
// (complete frame rejected for CRC — rest advances past it).
func takeFrame809(buf []byte) (payload []byte, rest []byte, ok, crcFail bool) {
	start := -1
	for i, b := range buf {
		if b == 0x5b {
			start = i
			break
		}
	}
	if start < 0 {
		return nil, nil, false, false
	}
	if start > 0 {
		buf = buf[start:]
		start = 0
	}
	end := -1
	for i := 1; i < len(buf); i++ {
		if buf[i] == 0x5d {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, buf, false, false
	}
	inner := buf[1:end]
	rest = buf[end+1:]
	raw := unescape809(inner)
	if len(raw) < 2 {
		return nil, rest, false, false
	}
	got := binary.BigEndian.Uint16(raw[len(raw)-2:])
	body := raw[:len(raw)-2]
	want := crc16CCITTFalse(body)
	if want != got {
		metrics.DecodeErr()
		return nil, rest, false, true
	}
	return body, rest, true, false
}

// wrapFrame809 builds 0x5B + escaped(body+CRC) + 0x5D for experimental replies.
func wrapFrame809(body []byte) []byte {
	crc := crc16CCITTFalse(body)
	withCRC := make([]byte, len(body)+2)
	copy(withCRC, body)
	binary.BigEndian.PutUint16(withCRC[len(body):], crc)
	esc := escape809(withCRC)
	out := make([]byte, 0, len(esc)+2)
	out = append(out, 0x5b)
	out = append(out, esc...)
	out = append(out, 0x5d)
	return out
}

func escape809(raw []byte) []byte {
	out := make([]byte, 0, len(raw)+8)
	for _, b := range raw {
		switch b {
		case 0x5b:
			out = append(out, 0x5a, 0x01)
		case 0x5a:
			out = append(out, 0x5a, 0x02)
		case 0x5d:
			out = append(out, 0x5e, 0x01)
		case 0x5e:
			out = append(out, 0x5e, 0x02)
		default:
			out = append(out, b)
		}
	}
	return out
}
