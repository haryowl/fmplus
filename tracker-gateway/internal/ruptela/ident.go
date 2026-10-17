package ruptela

import (
	"strings"
)

// parseIdentResponse splits a common FM identification ASCII blob into remappable keys.
// Layouts vary; tokens like "FW:…", "HW:…", "CFG:…" or space/semicolon-separated fields.
func parseIdentResponse(raw string) map[string]any {
	out := map[string]any{
		"proto_msg": "ruptela_cmd_3",
		"ident":     raw,
	}
	if raw == "" {
		return out
	}
	// Prefer key:value tokens anywhere in the blob.
	for _, tok := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ';' || r == ',' || r == '\n' || r == '\r' || r == '\t'
	}) {
		tok = strings.TrimSpace(tok)
		if tok == "" {
			continue
		}
		kv := strings.SplitN(tok, ":", 2)
		if len(kv) != 2 {
			kv = strings.SplitN(tok, "=", 2)
		}
		if len(kv) != 2 {
			continue
		}
		k := strings.ToLower(strings.TrimSpace(kv[0]))
		v := strings.TrimSpace(kv[1])
		if v == "" {
			continue
		}
		switch k {
		case "fw", "firmware", "ver", "version":
			out["ident.fw"] = v
		case "hw", "hardware":
			out["ident.hw"] = v
		case "cfg", "config", "configuration":
			out["ident.cfg"] = v
		case "imei":
			out["ident.imei"] = v
		case "model", "mod":
			out["ident.model"] = v
		}
	}
	// Fallback: whitespace-separated FW HW CFG when no labeled keys matched.
	if out["ident.fw"] == nil && out["ident.hw"] == nil {
		parts := strings.Fields(raw)
		if len(parts) >= 1 {
			out["ident.fw"] = parts[0]
		}
		if len(parts) >= 2 {
			out["ident.hw"] = parts[1]
		}
		if len(parts) >= 3 {
			out["ident.cfg"] = parts[2]
		}
	}
	return out
}
