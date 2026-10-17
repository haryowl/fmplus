package teltonika

import (
	"encoding/binary"
	"fmt"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// CRC16 IBM / ARC used by Teltonika AVL (poly 0xA001).
func crc16IBM(data []byte) uint16 {
	var crc uint16
	for _, b := range data {
		crc ^= uint16(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xA001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

func verifyAVLCRC(payload, crcBuf []byte) bool {
	if len(crcBuf) < 4 {
		return false
	}
	got := binary.BigEndian.Uint32(crcBuf)
	want := uint32(crc16IBM(payload))
	return got == want
}

func parseAVL(payload []byte) (int, []store.Fix) {
	if len(payload) < 2 {
		return 0, nil
	}
	codec := payload[0]
	var n, off int
	if codec == 0x8e {
		// Codec 8 Extended: number of records is uint16 BE
		if len(payload) < 3 {
			return 0, nil
		}
		n = int(binary.BigEndian.Uint16(payload[1:3]))
		off = 3
	} else {
		n = int(payload[1])
		off = 2
	}
	if n == 0 {
		return 0, nil
	}
	var fixes []store.Fix
	for i := 0; i < n && off+24 <= len(payload); i++ {
		tsMs := int64(binary.BigEndian.Uint64(payload[off : off+8]))
		off += 8
		off++ // priority
		if off+15 > len(payload) {
			break
		}
		lonRaw := int32(binary.BigEndian.Uint32(payload[off : off+4]))
		off += 4
		latRaw := int32(binary.BigEndian.Uint32(payload[off : off+4]))
		off += 4
		alt := int16(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2
		angle := int(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2
		sats := int(payload[off])
		off++
		speed := int(binary.BigEndian.Uint16(payload[off : off+2]))
		off += 2

		lon := float64(lonRaw) / 1e7
		lat := float64(latRaw) / 1e7
		spd := float64(speed)
		hdg := float64(angle)
		altF := float64(alt)
		io := map[string]any{}
		var eventID any

		if codec == 0x08 {
			off, eventID, io = extractIO8(payload, off)
		} else if codec == 0x8e {
			off, eventID, io = extractIO8E(payload, off)
		} else {
			fixes = append(fixes, store.Fix{
				Lat: lat, Lon: lon, RecordedAt: time.UnixMilli(tsMs).UTC(),
				Speed: &spd, Heading: &hdg, Altitude: &altF, Satellites: &sats,
				RawAttrs: map[string]any{"codec": codec, "io": io},
			})
			break
		}

		raw := map[string]any{
			"codec":    codec,
			"io":       io,
			"event_io": eventID,
		}
		// Promote common AVL ids into typed hints when present
		fix := store.Fix{
			Lat: lat, Lon: lon, RecordedAt: time.UnixMilli(tsMs).UTC(),
			Speed: &spd, Heading: &hdg, Altitude: &altF, Satellites: &sats,
			RawAttrs: raw,
		}
		if v, ok := io["239"]; ok {
			b := asIOBool(v)
			fix.Ignition = &b
		}
		if v, ok := io["16"]; ok {
			f := asIOFloat(v)
			fix.Odometer = &f
		}
		fixes = append(fixes, fix)
	}
	return n, fixes
}

func extractIO8(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off >= len(b) {
		return off, event, io
	}
	event = int(b[off])
	off++
	if off >= len(b) {
		return off, event, io
	}
	off++ // total IO count (informational)
	off = readSizedIO8(b, off, 1, io)
	off = readSizedIO8(b, off, 2, io)
	off = readSizedIO8(b, off, 4, io)
	off = readSizedIO8(b, off, 8, io)
	return off, event, io
}

func readSizedIO8(b []byte, off, size int, io map[string]any) int {
	if off >= len(b) {
		return off
	}
	n := int(b[off])
	off++
	for i := 0; i < n && off+1+size <= len(b); i++ {
		id := int(b[off])
		off++
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

func extractIO8E(b []byte, off int) (int, any, map[string]any) {
	io := map[string]any{}
	var event any
	if off+2 > len(b) {
		return off, event, io
	}
	event = int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	if off+2 > len(b) {
		return off, event, io
	}
	off += 2 // total IO u16
	off = readSizedIO8E(b, off, 1, io)
	off = readSizedIO8E(b, off, 2, io)
	off = readSizedIO8E(b, off, 4, io)
	off = readSizedIO8E(b, off, 8, io)
	// NX variable
	if off+2 > len(b) {
		return off, event, io
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	for i := 0; i < n && off+4 <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		l := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		if off+l > len(b) {
			break
		}
		io[fmt.Sprintf("%d", id)] = fmt.Sprintf("%x", b[off:off+l])
		off += l
	}
	return off, event, io
}

func readSizedIO8E(b []byte, off, size int, io map[string]any) int {
	if off+2 > len(b) {
		return off
	}
	n := int(binary.BigEndian.Uint16(b[off : off+2]))
	off += 2
	for i := 0; i < n && off+2+size <= len(b); i++ {
		id := int(binary.BigEndian.Uint16(b[off : off+2]))
		off += 2
		io[fmt.Sprintf("%d", id)] = readIntBE(b[off:off+size], size)
		off += size
	}
	return off
}

func readIntBE(b []byte, size int) any {
	switch size {
	case 1:
		return int(b[0])
	case 2:
		return int(binary.BigEndian.Uint16(b))
	case 4:
		return int64(binary.BigEndian.Uint32(b))
	case 8:
		return int64(binary.BigEndian.Uint64(b))
	default:
		return fmt.Sprintf("%x", b)
	}
}

func asIOBool(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int:
		return t != 0
	case int64:
		return t != 0
	default:
		return false
	}
}

func asIOFloat(v any) float64 {
	switch t := v.(type) {
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float64:
		return t
	default:
		return 0
	}
}
