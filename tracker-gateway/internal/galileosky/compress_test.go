package galileosky

import (
	"testing"
	"time"
)

type bitWriter struct {
	data []byte
	nbit int
	cur  int
}

func (w *bitWriter) write(val uint32, length int) {
	for length > 0 {
		space := 8 - w.nbit
		if space > length {
			space = length
		}
		w.cur = (w.cur << space) | (int(val>>(length-space)) & ((1 << space) - 1))
		val &= uint32((1 << (length - space)) - 1)
		w.nbit += space
		length -= space
		if w.nbit == 8 {
			w.data = append(w.data, byte(w.cur))
			w.cur = 0
			w.nbit = 0
		}
	}
}

func u32(f float64) uint32 { return uint32(f) }

func (w *bitWriter) finish10() []byte {
	if w.nbit > 0 {
		w.cur <<= (8 - w.nbit)
		w.data = append(w.data, byte(w.cur))
		w.cur = 0
		w.nbit = 0
	}
	for len(w.data) < 10 {
		w.data = append(w.data, 0)
	}
	return w.data[:10]
}

func TestDecodeMinimalDataSet_DeviceTime(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	const secFromYear = uint32(20 * 24 * 3600) // 21 Jan 00:00
	w := &bitWriter{}
	w.write(0, 1)
	w.write(secFromYear, 25)
	w.write(0, 1) // valid GNSS
	// lon 122.5 → (122.5+180)/360 * 4194304
	lonBits := u32((122.5 + 180) / 360 * 4_194_304)
	latBits := u32((-4.0 + 90) / 180 * 2_097_152)
	w.write(lonBits, 22)
	w.write(latBits, 21)
	w.write(0, 1)
	raw := w.finish10()

	fix, ok := decodeMinimalDataSet(raw, now)
	if !ok {
		t.Fatal("decode")
	}
	if !fix.RawAttrs["gps.valid"].(bool) {
		t.Fatalf("valid=%v", fix.RawAttrs)
	}
	want := time.Date(2026, 1, 21, 0, 0, 0, 0, time.UTC)
	if fix.RecordedAt.UTC().Unix() != want.Unix() {
		t.Fatalf("time=%v want %v", fix.RecordedAt, want)
	}
	if fix.Lon < 122.4 || fix.Lon > 122.6 {
		t.Fatalf("lon=%v", fix.Lon)
	}
	if fix.Lat > -3.9 || fix.Lat < -4.1 {
		t.Fatalf("lat=%v", fix.Lat)
	}
}

func TestParseCompressedPositions_EmptyTags(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	w := &bitWriter{}
	w.write(0, 1)
	w.write(1000, 25)
	w.write(0, 1)
	w.write(u32((106.8+180)/360*4_194_304), 22)
	w.write(u32((-6.2+90)/180*2_097_152), 21)
	w.write(0, 1)
	payload := append(w.finish10(), 0) // 0 extra tags
	fixes := parseCompressedPositions(payload, now)
	if len(fixes) != 1 {
		t.Fatalf("n=%d", len(fixes))
	}
	if fixes[0].RecordedAt.IsZero() {
		t.Fatal("compressed time must come from bitfield, not 0x20")
	}
}
