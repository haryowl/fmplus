package galileosky

import (
	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

// applyStatusTags promotes 0x40–0x45 into remappable keys.
// Bit meanings vary by firmware; only high-confidence SOS (0x40 bit0) raises safety.
func applyStatusTags(tags map[byte][]byte, raw map[string]any) *store.SafetyEvent {
	if raw == nil {
		return nil
	}
	var sos bool
	for _, id := range []byte{0x40, 0x41, 0x42, 0x43, 0x44, 0x45} {
		v, ok := tags[id]
		if !ok || len(v) < 1 {
			continue
		}
		val := int(v[0])
		key := "tag.0x" + hex2(id)
		raw[key] = val
		raw["status."+key] = val
		if id == 0x40 && val&0x01 != 0 {
			sos = true
			raw["alarm.sos"] = true
		}
	}
	if !sos {
		return nil
	}
	return &store.SafetyEvent{
		AlarmType:      "sos",
		AlarmLevel:     2,
		RawAttrs:       map[string]any{"alarm.sos": true, "tag.0x40": raw["tag.0x40"]},
		SourceProtocol: "galileosky",
	}
}

func hex2(b byte) string {
	const h = "0123456789abcdef"
	return string([]byte{h[b>>4], h[b&0x0f]})
}
