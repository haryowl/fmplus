package galileosky

import (
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// bitBuf reads MSB-first unsigned fields, matching Traccar BitBuffer.
type bitBuf struct {
	data []byte
	off  int
	nbit int // remaining bits in cur
	cur  int
}

func newBitBuf(data []byte) *bitBuf {
	return &bitBuf{data: data}
}

func (b *bitBuf) readUnsigned(length int) uint32 {
	var result uint32
	for length > 0 {
		if b.nbit == 0 {
			if b.off >= len(b.data) {
				return result
			}
			b.cur = int(b.data[b.off])
			b.off++
			b.nbit = 8
		}
		if b.nbit >= length {
			result <<= length
			result |= uint32(b.cur >> (b.nbit - length))
			b.cur &= (1 << (b.nbit - length)) - 1
			b.nbit -= length
			length = 0
		} else {
			result <<= b.nbit
			result |= uint32(b.cur)
			length -= b.nbit
			b.cur = 0
			b.nbit = 0
		}
	}
	return result
}

func compressedDeviceTime(sec uint32, now time.Time) time.Time {
	now = now.UTC()
	t := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(sec) * time.Second)
	if t.After(now.Add(7 * 24 * time.Hour)) {
		t = time.Date(now.Year()-1, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(sec) * time.Second)
	}
	return t
}

func decodeMinimalDataSet(raw []byte, now time.Time) (store.Fix, bool) {
	if len(raw) < 10 {
		return store.Fix{}, false
	}
	bits := newBitBuf(raw[:10])
	_ = bits.readUnsigned(1)
	sec := bits.readUnsigned(25)
	valid := bits.readUnsigned(1) == 0
	lon := 360*float64(bits.readUnsigned(22))/4_194_304.0 - 180
	lat := 180*float64(bits.readUnsigned(21))/2_097_152.0 - 90
	alarm := bits.readUnsigned(1) > 0
	recorded := compressedDeviceTime(sec, now)
	fix := store.Fix{
		Lat:            lat,
		Lon:            lon,
		RecordedAt:     recorded,
		SourceProtocol: "galileosky",
		RawAttrs: map[string]any{
			"gps.valid":       valid && store.ValidCoords(lat, lon),
			"compressed":      true,
			"unix_time":       recorded.Unix(),
			"gnss.fix":        valid && store.ValidCoords(lat, lon),
			"gnss.valid_nibble": map[bool]int{true: 0, false: 1}[valid],
		},
	}
	if !valid || !store.ValidCoords(lat, lon) {
		fix.Lat, fix.Lon = 0, 0
		fix.RawAttrs["gps.valid"] = false
		fix.RawAttrs["gnss.invalid"] = true
		delete(fix.RawAttrs, "gnss.fix")
	}
	if alarm {
		fix.RawAttrs["alarm.general"] = true
	}
	return fix, true
}

// parseCompressedPositions decodes a Galileosky 0x08 payload (no header/CRC).
// Each point carries device time in the 10-byte bitfield (seconds from 1 Jan UTC),
// not tag 0x20.
func parseCompressedPositions(payload []byte, now time.Time) []store.Fix {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var out []store.Fix
	off := 0
	for off+10 < len(payload) {
		fix, ok := decodeMinimalDataSet(payload[off:], now)
		if !ok {
			break
		}
		off += 10
		if off >= len(payload) {
			break
		}
		nTags := int(payload[off])
		off++
		if nTags < 0 || off+nTags > len(payload) {
			break
		}
		ids := payload[off : off+nTags]
		off += nTags
		tags := map[byte][]byte{}
		okVals := true
		for _, id := range ids {
			size := tagSize(id)
			if size == -3 {
				if off >= len(payload) {
					okVals = false
					break
				}
				n := int(payload[off])
				off++
				if n < 0 || off+n > len(payload) {
					okVals = false
					break
				}
				tags[id] = append([]byte(nil), payload[off:off+n]...)
				off += n
				continue
			}
			if size == -2 {
				if off+2 > len(payload) {
					okVals = false
					break
				}
				n := int(uint16(payload[off]) | uint16(payload[off+1])<<8)
				off += 2
				if n < 0 || off+n > len(payload) {
					okVals = false
					break
				}
				tags[id] = append([]byte(nil), payload[off:off+n]...)
				off += n
				continue
			}
			if size < 0 {
				okVals = false
				break
			}
			if off+size > len(payload) {
				okVals = false
				break
			}
			tags[id] = append([]byte(nil), payload[off:off+size]...)
			off += size
		}
		if !okVals {
			break
		}
		if sc, ok := tags[0x33]; ok && len(sc) >= 4 {
			spd := float64(uint16(sc[0])|uint16(sc[1])<<8) / 10.0
			hdg := float64(uint16(sc[2])|uint16(sc[3])<<8) / 10.0
			fix.Speed = &spd
			fix.Heading = &hdg
		}
		if h, ok := tags[0x34]; ok && len(h) >= 2 {
			alt := float64(int16(uint16(h[0]) | uint16(h[1])<<8))
			fix.Altitude = &alt
		}
		promoteSensorTags(fix.RawAttrs, tags)
		out = append(out, fix)
	}
	return out
}
