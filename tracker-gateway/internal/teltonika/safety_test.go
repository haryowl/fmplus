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

func TestSafetyFromEventIO_Expanded(t *testing.T) {
	cases := map[int]string{1: "sos", 240: "movement", 254: "trip"}
	for id, want := range cases {
		ev := safetyFromEventIO(store.Fix{
			Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
			RawAttrs: map[string]any{"event_io": id},
		})
		if ev == nil || ev.AlarmType != want {
			t.Fatalf("id=%d ev=%+v want %s", id, ev, want)
		}
	}
}
