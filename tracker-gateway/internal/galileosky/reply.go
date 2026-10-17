package galileosky

import (
	"fmt"
	"strings"
	"unicode"
)

// formatCommandReply builds a human-readable ack string from E0–E6 / opaque tags.
func formatCommandReply(tags map[byte][]byte) (text string, ok bool) {
	for _, id := range []byte{0xe6, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe0} {
		v, exists := tags[id]
		if !exists || len(v) == 0 {
			continue
		}
		s := strings.TrimSpace(string(v))
		if isMostlyPrintable(s) {
			return s, !commandReplyFailed(s)
		}
		return fmt.Sprintf("tag.0x%02x=%x", id, v), true
	}
	if v, ok := tags[0xff]; ok && len(v) > 0 {
		s := strings.TrimSpace(string(v))
		if isMostlyPrintable(s) {
			return s, !commandReplyFailed(s)
		}
	}
	raw := tagsToRaw(tags)
	return fmt.Sprintf("galileosky tags %v", raw), true
}

func commandReplyFailed(s string) bool {
	u := strings.ToUpper(strings.TrimSpace(s))
	for _, p := range []string{"ERROR", "FAIL", "DENIED", "UNKNOWN", "NACK"} {
		if strings.HasPrefix(u, p) || strings.Contains(u, " "+p) {
			return true
		}
	}
	return false
}

func isMostlyPrintable(s string) bool {
	if s == "" {
		return false
	}
	ok := 0
	for _, r := range s {
		if unicode.IsPrint(r) || r == '\n' || r == '\r' || r == '\t' {
			ok++
		}
	}
	return ok*100/len([]rune(s)) >= 80
}
