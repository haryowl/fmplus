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

func TestSafetyFromIO_CrashWhenEventZero(t *testing.T) {
	fix := store.Fix{
		Lat: -6, Lon: 106, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 0,
			"io":       map[string]any{"247": 1},
		},
	}
	ev := safetyFromIO(fix)
	if ev == nil || ev.AlarmType != "crash" {
		t.Fatalf("ev=%+v", ev)
	}
	if safetyFromEventIO(fix) != nil {
		t.Fatal("event_io path should be nil")
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
		t.Fatal("expected nil when event_io owns the alarm")
	}
}

func TestFlattenIOAlarms(t *testing.T) {
	raw := map[string]any{}
	flattenIOAlarms(raw, map[string]any{"246": 1, "21": 5})
	if raw["alarm.towing"] != true {
		t.Fatalf("%v", raw)
	}
}

func TestFlattenIOAlarms_Idling(t *testing.T) {
	raw := map[string]any{}
	flattenIOAlarms(raw, map[string]any{"251": 1})
	if raw["alarm.idling"] != true {
		t.Fatalf("%v", raw)
	}
}

func TestFlattenEventAlarm_GreenDrivingDuration(t *testing.T) {
	raw := map[string]any{"event_io": 243}
	flattenEventAlarm(raw)
	if raw["alarm.green_driving_duration"] != true {
		t.Fatalf("%v", raw)
	}
	fix := store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{"event_io": 243},
	}
	ev := safetyFromEventIO(fix)
	if ev == nil || ev.AlarmType != "green_driving" {
		t.Fatalf("%+v", ev)
	}
}

func TestSafetyFromIO_Overspeed(t *testing.T) {
	fix := store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 0,
			"io":       map[string]any{"255": 1},
		},
	}
	ev := safetyFromIO(fix)
	if ev == nil || ev.AlarmType != "overspeed" {
		t.Fatalf("%+v", ev)
	}
}

func TestSafetyFromIO_IdlingAndGeofence(t *testing.T) {
	fix := store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 0,
			"io":       map[string]any{"251": 1},
		},
	}
	ev := safetyFromIO(fix)
	if ev == nil || ev.AlarmType != "idling" {
		t.Fatalf("idling=%+v", ev)
	}
	fix.RawAttrs["io"] = map[string]any{"175": 1}
	ev2 := safetyFromIO(fix)
	if ev2 == nil || ev2.AlarmType != "geofence" {
		t.Fatalf("geofence=%+v", ev2)
	}
}
