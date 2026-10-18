package galileosky

import (
	"encoding/binary"
	"fmt"
	"strings"
	"unicode"
)

// formatCommandReply builds a human-readable ack from official 0xE1 text / 0xEB binary.
func formatCommandReply(tags map[byte][]byte) (text string, ok bool) {
	if v, exists := tags[0xe1]; exists && len(v) > 0 {
		s := strings.TrimSpace(string(v))
		if isMostlyPrintable(s) {
			return s, !commandReplyFailed(s)
		}
		return fmt.Sprintf("tag.0xe1=%x", v), true
	}
	if v, exists := tags[0xeb]; exists && len(v) > 0 {
		s := strings.TrimSpace(string(v))
		if isMostlyPrintable(s) {
			return s, !commandReplyFailed(s)
		}
		return fmt.Sprintf("tag.0xeb=%x", v), true
	}
	if v, exists := tags[0xe0]; exists && len(v) >= 4 {
		return fmt.Sprintf("cmd.id=%d", binary.LittleEndian.Uint32(v[:4])), true
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
