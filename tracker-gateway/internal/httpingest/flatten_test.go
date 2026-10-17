package httpingest

import (
	"net/http"
	"testing"
)

func TestFlattenNestedVendorKeys(t *testing.T) {
	raw := map[string]any{
		"io":     map[string]any{"239": float64(1)},
		"tags":   map[string]any{"0x46": float64(1)},
		"add":    map[string]any{"0x01": float64(100)},
		"status": map[string]any{"acc": true},
		"alarm":  map[string]any{"sos": true},
	}
	flattenNestedVendorKeys(raw)
	if raw["io.239"] != float64(1) {
		t.Fatalf("io.239=%v", raw["io.239"])
	}
	if raw["tag.0x46"] != float64(1) {
		t.Fatalf("tag=%v", raw["tag.0x46"])
	}
	if raw["add.0x01"] != float64(100) {
		t.Fatalf("add=%v", raw["add.0x01"])
	}
	if raw["status.acc"] != true {
		t.Fatalf("status.acc=%v", raw["status.acc"])
	}
	if raw["alarm.sos"] != true {
		t.Fatalf("alarm.sos=%v", raw["alarm.sos"])
	}
}

func TestFlatten_AttrsMergeKeysPreferAttrs(t *testing.T) {
	// Mimic ingest path: top-level then attrs overlay, then flatten.
	payload := map[string]any{
		"lat":  -6.2,
		"lon":  106.8,
		"io":   map[string]any{"239": float64(0)},
		"attrs": map[string]any{
			"io": map[string]any{"239": float64(1)},
		},
	}
	rawAttrs := map[string]any{}
	for k, v := range payload {
		if k == "lat" || k == "lon" || k == "attrs" {
			continue
		}
		rawAttrs[k] = v
	}
	if attrs, ok := payload["attrs"].(map[string]any); ok {
		for k, v := range attrs {
			rawAttrs[k] = v
		}
	}
	flattenNestedVendorKeys(rawAttrs)
	if rawAttrs["io.239"] != float64(1) {
		t.Fatalf("attrs should win io.239=%v", rawAttrs["io.239"])
	}
}

func TestBearer_AuthorizationAndHeader(t *testing.T) {
	r, _ := http.NewRequest(http.MethodPost, "/", nil)
	r.Header.Set("Authorization", "Bearer  abc123  ")
	if got := bearer(r); got != "abc123" {
		t.Fatalf("bearer=%q", got)
	}
	r2, _ := http.NewRequest(http.MethodPost, "/", nil)
	r2.Header.Set("X-Device-Token", " tok-x ")
	if got := bearer(r2); got != "tok-x" {
		t.Fatalf("x-device-token=%q", got)
	}
}

func TestHashToken_Stable(t *testing.T) {
	a := hashToken("secret")
	b := hashToken("secret")
	if a != b || len(a) != 64 {
		t.Fatalf("hash=%q", a)
	}
	if hashToken("other") == a {
		t.Fatal("different tokens must differ")
	}
}

func TestAsBoolPtr_Edges(t *testing.T) {
	if v := asBoolPtr("yes"); v == nil || !*v {
		t.Fatal("yes")
	}
	if v := asBoolPtr("no"); v == nil || *v {
		t.Fatal("no")
	}
	if v := asBoolPtr(float64(0)); v == nil || *v {
		t.Fatal("0")
	}
	if asBoolPtr(nil, "maybe") != nil {
		t.Fatal("unknown string")
	}
}

func TestAsFloat_StringAndNumber(t *testing.T) {
	if v := asFloat("40.5"); v == nil || *v != 40.5 {
		t.Fatalf("string float=%v", v)
	}
	if v := asFloat(float64(12)); v == nil || *v != 12 {
		t.Fatalf("number=%v", v)
	}
}

func TestParseTime_UnixMs(t *testing.T) {
	ts := parseTime(float64(1_717_200_000_000))
	if ts.Year() < 2024 {
		t.Fatalf("ts=%v", ts)
	}
}

func TestParseTime_RFC3339(t *testing.T) {
	ts := parseTime("2024-06-01T10:30:00Z")
	if ts.Month() != 6 || ts.Hour() != 10 {
		t.Fatalf("ts=%v", ts)
	}
}
