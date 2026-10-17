package concox

import (
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestParseHeartbeat(t *testing.T) {
	info := []byte{0x12, 0x04, 0x03} // ACC bit + voltage + gsm
	patch, ign := parseHeartbeat(info)
	if ign == nil || !*ign {
		t.Fatalf("expected ACC true, patch=%v", patch)
	}
	if patch["voltage_level"] != 4 || patch["gsm_signal"] != 3 {
		t.Fatalf("patch=%v", patch)
	}
}

func TestExtractAlarmCode(t *testing.T) {
	info := []byte{0x00, 0x00, 0x01, 0x00, 0x01} // SOS near end before language
	code, ok := extractAlarmCode(info)
	if !ok || code != 0x01 {
		t.Fatalf("code=%x ok=%v", code, ok)
	}
}

func TestSafetyFromAlarm(t *testing.T) {
	info := []byte{0x00, 0x06, 0x00, 0x01}
	ev := safetyFromAlarm(info, store.Fix{RecordedAt: time.Now().UTC()})
	if ev == nil || ev.AlarmType != "overspeed" {
		t.Fatalf("ev=%+v", ev)
	}
	if ev.RawAttrs["alarm.overspeed"] != true {
		t.Fatalf("raw=%v", ev.RawAttrs)
	}
}

func TestApplyAlarmAttrs_OnFix(t *testing.T) {
	raw := map[string]any{}
	applyAlarmAttrs([]byte{0x00, 0x01, 0x00, 0x01}, raw) // SOS
	if raw["alarm.sos"] != true || raw["alarm_code"] != 1 {
		t.Fatalf("raw=%v", raw)
	}
}

func TestExtractAlarmCode_WearNotAtLenMinus3(t *testing.T) {
	// Prefer path sees 0 at len-3; fallback must still find wear 0x14 (was missing from old switch).
	info := []byte{0x11, 0x22, 0x33, 0x14, 0x00, 0xfe, 0x00}
	code, ok := extractAlarmCode(info)
	if !ok || code != 0x14 {
		t.Fatalf("code=%x ok=%v want wear 0x14", code, ok)
	}
	raw := map[string]any{}
	applyAlarmAttrs(info, raw)
	if raw["alarm.wear"] != true {
		t.Fatalf("raw=%v", raw)
	}
}
