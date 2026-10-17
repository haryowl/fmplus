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

func TestPromoteRuptelaScalars_OdometerIO16(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"16": 12345})
	if raw["odometer"] != 12345.0 {
		t.Fatalf("%v", raw)
	}
	raw2 := map[string]any{}
	promoteRuptelaScalars(raw2, map[string]any{"65": 99, "16": 12345})
	if raw2["odometer"] != 99.0 {
		t.Fatalf("65 should win: %v", raw2)
	}
}

func TestPromoteRuptelaScalars_FuelAVL(t *testing.T) {
	raw := map[string]any{}
	promoteRuptelaScalars(raw, map[string]any{"12": 10, "13": 2.5, "48": 1000, "84": 45.5})
	if raw["fuel.used"] != 10.0 || raw["fuel.rate"] != 2.5 || raw["fuel.used_total"] != 1000.0 {
		t.Fatalf("%v", raw)
	}
	if raw["fuel.volume"] != 45.5 {
		t.Fatalf("volume=%v", raw)
	}
	raw3 := map[string]any{}
	promoteRuptelaScalars(raw3, map[string]any{"36": 2200, "32": 90, "31": 55})
	if raw3["engine.rpm"] != 2200.0 {
		t.Fatalf("rpm=%v", raw3)
	}
	if raw3["engine.coolant_temp"] != 90.0 || raw3["engine.load"] != 55.0 {
		t.Fatalf("coolant/load=%v", raw3)
	}
	raw4 := map[string]any{}
	promoteRuptelaScalars(raw4, map[string]any{"75": 21.5, "41": 15, "42": 7200, "37": 60, "39": 30})
	if raw4["temp.4"] != 21.5 || raw4["engine.throttle"] != 15.0 || raw4["engine.runtime"] != 7200.0 {
		t.Fatalf("temp4/obd=%v", raw4)
	}
	if raw4["speed.obd"] != 60.0 || raw4["engine.intake_temp"] != 30.0 {
		t.Fatalf("speed/intake=%v", raw4)
	}
	raw5 := map[string]any{}
	promoteRuptelaScalars(raw5, map[string]any{"34": 280, "35": 110, "58": 100, "40": 2000})
	if raw5["fuel.pressure"] != 280.0 || raw5["engine.map"] != 110.0 || raw5["engine.oil_temp"] != 100.0 {
		t.Fatalf("map/pressure/oil=%v", raw5)
	}
	if raw5["engine.maf"] != 20.0 {
		t.Fatalf("maf=%v", raw5["engine.maf"])
	}
	raw6 := map[string]any{}
	promoteRuptelaScalars(raw6, map[string]any{"70": 301, "30": 2, "53": 18, "50": 99, "51": 13800})
	if raw6["pcb.temp"] != 30.1 {
		t.Fatalf("pcb=%v", raw6["pcb.temp"])
	}
	if raw6["obd.dtc_count"] != 2.0 || raw6["engine.ambient_temp"] != 18.0 {
		t.Fatalf("dtc/ambient=%v", raw6)
	}
	if raw6["engine.baro"] != 99.0 || raw6["obd.ecu_voltage"] != 13.8 {
		t.Fatalf("baro/ecu=%v", raw6)
	}
	raw7 := map[string]any{}
	promoteRuptelaScalars(raw7, map[string]any{"33": 3, "38": -2, "43": 80})
	if raw7["engine.short_fuel_trim"] != 3.0 || raw7["engine.timing_advance"] != -2.0 || raw7["obd.mil_distance"] != 80.0 {
		t.Fatalf("trim/timing/mil=%v", raw7)
	}
	raw2 := map[string]any{}
	promoteRuptelaScalars(raw2, map[string]any{"48": 500})
	if raw2["fuel.used"] != 500.0 || raw2["fuel.used_total"] != 500.0 {
		t.Fatalf("alias=%v", raw2)
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
