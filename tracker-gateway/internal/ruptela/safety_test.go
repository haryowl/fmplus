package ruptela

import (
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestSafetyFromEventIO_Overspeed(t *testing.T) {
	fix := store.Fix{
		Lat: -6.2, Lon: 106.8, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{"event_io": 255},
	}
	ev := safetyFromEventIO(fix)
	if ev == nil || ev.AlarmType != "overspeed" {
		t.Fatalf("ev=%+v", ev)
	}
	if ev.RawAttrs["alarm.overspeed"] != true {
		t.Fatalf("raw=%v", ev.RawAttrs)
	}
}

func TestSafetyFromEventIO_SOS(t *testing.T) {
	fix := store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{"event_io": 1},
	}
	ev := safetyFromEventIO(fix)
	if ev == nil || ev.AlarmType != "sos" {
		t.Fatalf("%+v", ev)
	}
}

func TestSafetyFromEventIO_Unknown(t *testing.T) {
	fix := store.Fix{RawAttrs: map[string]any{"event_io": 999}}
	if safetyFromEventIO(fix) != nil {
		t.Fatal("expected nil for unknown event")
	}
	if safetyFromEventIO(store.Fix{}) != nil {
		t.Fatal("expected nil for empty")
	}
}

func TestFlattenEventAlarm(t *testing.T) {
	raw := map[string]any{"event_io": 246}
	flattenEventAlarm(raw)
	if raw["alarm.towing"] != true {
		t.Fatalf("raw=%v", raw)
	}
}

func TestFlattenIOAlarms(t *testing.T) {
	raw := map[string]any{}
	flattenIOAlarms(raw, map[string]any{"246": 1, "21": 5})
	if raw["alarm.towing"] != true {
		t.Fatalf("raw=%v", raw)
	}
}

func TestSafetyFromIO_Crash(t *testing.T) {
	fix := store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 0,
			"io":       map[string]any{"247": 1},
		},
	}
	ev := safetyFromIO(fix)
	if ev == nil || ev.AlarmType != "crash" {
		t.Fatalf("%+v", ev)
	}
}

func TestSafetyFromIO_SkipsWhenEventSet(t *testing.T) {
	fix := store.Fix{
		RawAttrs: map[string]any{
			"event_io": 255,
			"io":       map[string]any{"247": 1},
		},
	}
	if safetyFromIO(fix) != nil {
		t.Fatal("expected nil when event_io set")
	}
}
