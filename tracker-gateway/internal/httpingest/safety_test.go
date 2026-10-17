package httpingest

import (
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestSafetyFromJSONAttrs_SOS(t *testing.T) {
	fix := store.Fix{
		Lat: -6.2, Lon: 106.8, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{"alarm.sos": true},
	}
	ev := safetyFromJSONAttrs(fix)
	if ev == nil || ev.AlarmType != "sos" || ev.AlarmLevel != 2 {
		t.Fatalf("ev=%+v", ev)
	}
}

func TestSafetyFromJSONAttrs_EventIO(t *testing.T) {
	fix := store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{"event_io": float64(247)},
	}
	ev := safetyFromJSONAttrs(fix)
	if ev == nil || ev.AlarmType != "crash" {
		t.Fatalf("ev=%+v", ev)
	}
}

func TestSafetyFromJSONAttrs_None(t *testing.T) {
	if safetyFromJSONAttrs(store.Fix{RawAttrs: map[string]any{"io.239": 1}}) != nil {
		t.Fatal("expected nil")
	}
}

func TestSafetyFromJSONAttrs_ConcoxParity(t *testing.T) {
	for _, key := range []string{"alarm.remove", "alarm.fall", "alarm.wear"} {
		ev := safetyFromJSONAttrs(store.Fix{
			Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
			RawAttrs: map[string]any{key: true},
		})
		if ev == nil {
			t.Fatalf("expected safety for %s", key)
		}
	}
}
