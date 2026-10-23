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
	typed := safetyFromEventIO(store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 243,
			"io":       map[string]any{"243": 1500, "253": 2},
		},
	})
	if typed == nil || typed.AlarmType != "harsh_brake" {
		t.Fatalf("243+253 typed=%+v", typed)
	}
	if typed.RawAttrs["io_label"] != "Harsh braking" {
		t.Fatalf("243+253 label=%v", typed.RawAttrs)
	}
	flat := safetyFromEventIO(store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 253,
			"io.253":   3,
		},
	})
	if flat == nil || flat.AlarmType != "harsh_corner" {
		t.Fatalf("io.253=%+v", flat)
	}
}

func TestFlattenEventAlarm_SOS(t *testing.T) {
	raw := map[string]any{"event_io": 1}
	flattenEventAlarm(raw)
	if raw["alarm.sos"] != true || raw["alarm_level"] != 2 {
		t.Fatalf("sos1=%v", raw)
	}
	raw9 := map[string]any{"event_io": 9}
	flattenEventAlarm(raw9)
	if raw9["alarm.sos"] != true {
		t.Fatalf("sos9=%v", raw9)
	}
}

func TestFlattenEventAlarm_GreenDriving(t *testing.T) {
	raw := map[string]any{"event_io": 253}
	flattenEventAlarm(raw)
	if raw["alarm.green_driving"] != true || raw["alarm_level"] != 1 {
		t.Fatalf("%v", raw)
	}
	ev := safetyFromEventIO(store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{"event_io": 253},
	})
	if ev == nil || ev.AlarmType != "green_driving" {
		t.Fatalf("%+v", ev)
	}
	typed := safetyFromEventIO(store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io":            253,
			"green_driving.value": 2,
			"io":                  map[string]any{"253": 2},
		},
	})
	if typed == nil || typed.AlarmType != "harsh_brake" {
		t.Fatalf("typed=%+v", typed)
	}
	if typed.RawAttrs["io_label"] != "Harsh braking" {
		t.Fatalf("label=%v", typed.RawAttrs)
	}
}

func TestSafetyFromEventIO_IgnitionPermanentLabel(t *testing.T) {
	fromIO := safetyFromEventIO(store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 239,
			"io":       map[string]any{"239": 0},
		},
	})
	if fromIO == nil || fromIO.AlarmType != "ignition" {
		t.Fatalf("fromIO=%+v", fromIO)
	}
	if fromIO.RawAttrs["io_label"] != "Ignition off" {
		t.Fatalf("io label=%v", fromIO.RawAttrs)
	}
	fromStatus := safetyFromEventIO(store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io":         239,
			"status.ignition":  true,
		},
	})
	if fromStatus == nil || fromStatus.RawAttrs["io_label"] != "Ignition on" {
		t.Fatalf("status label=%v", fromStatus)
	}
}

func TestFlattenEventAlarm_GeofenceUnplug(t *testing.T) {
	raw := map[string]any{"event_io": 175}
	flattenEventAlarm(raw)
	if raw["alarm.geofence"] != true {
		t.Fatalf("geofence=%v", raw)
	}
	raw2 := map[string]any{"event_io": 252}
	flattenEventAlarm(raw2)
	if raw2["alarm.unplug"] != true {
		t.Fatalf("unplug=%v", raw2)
	}
	ev := safetyFromEventIO(store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{"event_io": 252},
	})
	if ev == nil || ev.AlarmType != "unplug" {
		t.Fatalf("%+v", ev)
	}
	raw3 := map[string]any{}
	flattenIOAlarms(raw3, map[string]any{"252": 1, "240": 1})
	if raw3["alarm.unplug"] != true || raw3["alarm.movement"] != true {
		t.Fatalf("io=%v", raw3)
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
