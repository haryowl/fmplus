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
	if raw["alarm_level"] != 2 {
		t.Fatalf("level=%v", raw["alarm_level"])
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

func TestSafetyFromIO_Idling(t *testing.T) {
	fix := store.Fix{
		Lat: 1, Lon: 2, RecordedAt: time.Now().UTC(),
		RawAttrs: map[string]any{
			"event_io": 0,
			"io":       map[string]any{"251": 1},
		},
	}
	ev := safetyFromIO(fix)
	if ev == nil || ev.AlarmType != "idling" {
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

func TestPromoteRuptelaScalars(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{
		"17": 10, "18": -5, "19": 980, "253": 2, "25": 215, "27": 180, "28": 190,
	})
	if raw["accel.x"] != 10.0 || raw["accel.y"] != -5.0 || raw["accel.z"] != 980.0 {
		t.Fatalf("accel %v", raw)
	}
	if raw["green_driving.value"] != 2.0 || raw["ble.temp1"] != 21.5 {
		t.Fatalf("green/ble %v", raw)
	}
	if raw["ble.temp3"] != 18.0 || raw["ble.temp4"] != 19.0 {
		t.Fatalf("ble34 %v", raw)
	}
}

func TestPromoteRuptelaScalars_EcoSleep(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"15": 88, "200": 1, "86": 90, "9": 12000})
	if raw["eco.score"] != 88.0 || raw["sleep.mode"] != 1.0 {
		t.Fatalf("%v", raw)
	}
	if raw["ble.battery"] != 90.0 || raw["voltage.ain1"] != 12.0 {
		t.Fatalf("ain/ble %v", raw)
	}
}

func TestPromoteRuptelaScalars_Ignition(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"239": 1, "89": 40})
	if raw["status.ignition"] != true || raw["fuel.level"] != 40.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteRuptelaScalars_DinDout(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"1": 1, "3": 1, "179": 1})
	if raw["status.din1"] != true || raw["status.din3"] != true || raw["status.dout1"] != true {
		t.Fatalf("%v", raw)
	}
	promoteRuptelaScalars(raw, map[string]any{"2": 1, "4": 1, "180": 1})
	if raw["status.din2"] != true || raw["status.din4"] != true || raw["status.dout2"] != true {
		t.Fatalf("din24/dout2=%v", raw)
	}
	promoteRuptelaScalars(raw, map[string]any{"5": 1, "8": 1})
	if raw["status.din5"] != true || raw["status.din8"] != true {
		t.Fatalf("din58=%v", raw)
	}
}

func TestPromoteRuptelaScalars_BLETemp2GNSS(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"26": 215, "69": 1})
	if raw["ble.temp2"] != 21.5 || raw["gnss.status"] != 1.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteRuptelaScalars_IButton(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"78": "deadbeef", "250": 9.5})
	if raw["ibutton.id"] != "deadbeef" || raw["trip.distance"] != 9.5 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteRuptelaScalars_SpeedTripHumidity(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"24": 62, "199": 5000, "29": 55})
	if raw["speed.io"] != 62.0 || raw["trip.odometer"] != 5000.0 || raw["ble.humidity"] != 55.0 {
		t.Fatalf("%v", raw)
	}
	if raw["odometer"] != 5.0 { // 199÷1000 when 65 absent
		t.Fatalf("odo199=%v", raw["odometer"])
	}
	promoteRuptelaScalars(raw, map[string]any{"65": 42000, "199": 5000})
	if raw["odometer"] != 42000.0 {
		t.Fatalf("odo65=%v", raw["odometer"])
	}
}

func TestFlattenEventAlarm_GenericExtVoltage(t *testing.T) {
	raw := map[string]any{"event_io": 236}
	flattenEventAlarm(raw)
	if raw["alarm.generic"] != true {
		t.Fatalf("generic=%v", raw)
	}
	raw2 := map[string]any{"event_io": 66}
	flattenEventAlarm(raw2)
	if raw2["alarm.ext_voltage"] != true {
		t.Fatalf("ext=%v", raw2)
	}
}

func TestPromoteRuptelaScalars_OverspeedICCID(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"255": 90, "11": 898600123})
	if raw["overspeed.threshold"] != 90.0 || raw["gsm.iccid"] != "898600123" {
		t.Fatalf("%v", raw)
	}
}
