package teltonika

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
}

func TestSafetyFromEventIO_IgnoreZero(t *testing.T) {
	fix := store.Fix{RawAttrs: map[string]any{"event_io": 0}}
	if safetyFromEventIO(fix) != nil {
		t.Fatal("expected nil")
	}
}

func TestFlattenEventAlarm(t *testing.T) {
	raw := map[string]any{"event_io": 247}
	flattenEventAlarm(raw)
	if raw["alarm.crash"] != true {
		t.Fatalf("raw=%v", raw)
	}
}
