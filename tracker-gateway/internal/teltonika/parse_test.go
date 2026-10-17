package teltonika

import (
	"encoding/binary"
	"encoding/hex"
	"math"
	"testing"
	"time"
)

// Golden Codec 8 AVL payload: 1 record near Jakarta, empty IO block.
const goldenCodec8Hex = "" +
	"08" + // codec
	"01" + // 1 record
	"0000000000000000" + // timestamp ms (stamped in test)
	"00" + // priority
	"3fa86300" + // lon 106.8 * 1e7
	"fc4df480" + // lat -6.2 * 1e7
	"001e" + // alt 30
	"005a" + // angle 90
	"0c" + // sats 12
	"0028" + // speed 40
	"00" + // event IO
	"00" + // total IO
	"00" + // N1
	"00" + // N2
	"00" + // N4
	"00" // N8

func TestParseAVL_Codec8Golden(t *testing.T) {
	payload := mustHex(t, goldenCodec8Hex)
	ts := time.Date(2024, 6, 1, 10, 30, 0, 0, time.UTC)
	binary.BigEndian.PutUint64(payload[2:10], uint64(ts.UnixMilli()))

	n, fixes := parseAVL(payload)
	if n != 1 {
		t.Fatalf("count=%d want 1", n)
	}
	if len(fixes) != 1 {
		t.Fatalf("fixes=%d want 1", len(fixes))
	}
	f := fixes[0]
	if math.Abs(f.Lat-(-6.2)) > 1e-5 {
		t.Errorf("lat=%v want ~-6.2", f.Lat)
	}
	if math.Abs(f.Lon-106.8) > 1e-5 {
		t.Errorf("lon=%v want ~106.8", f.Lon)
	}
	if f.Speed == nil || *f.Speed != 40 {
		t.Errorf("speed=%v want 40", f.Speed)
	}
	if f.Heading == nil || *f.Heading != 90 {
		t.Errorf("heading=%v want 90", f.Heading)
	}
	if f.Satellites == nil || *f.Satellites != 12 {
		t.Errorf("sats=%v want 12", f.Satellites)
	}
	if !f.RecordedAt.Equal(ts) {
		t.Errorf("recordedAt=%v want %v", f.RecordedAt, ts)
	}
}

func TestParseAVL_Empty(t *testing.T) {
	n, fixes := parseAVL([]byte{0x08, 0x00})
	if n != 0 || len(fixes) != 0 {
		t.Fatalf("got n=%d fixes=%d", n, len(fixes))
	}
	n, fixes = parseAVL(nil)
	if n != 0 || fixes != nil {
		t.Fatalf("nil payload: n=%d fixes=%v", n, fixes)
	}
}

func TestParseAVL_BuiltCodec8MatchesGoldenLayout(t *testing.T) {
	lonRaw := int32(math.Round(106.8 * 1e7))
	latRaw := int32(math.Round(-6.2 * 1e7))
	if uint32(lonRaw) != 0x3fa86300 {
		t.Fatalf("lon raw=%08x", uint32(lonRaw))
	}
	if uint32(latRaw) != 0xfc4df480 {
		t.Fatalf("lat raw=%08x", uint32(latRaw))
	}
}

func TestExtractIO8E_EventIDTwoBytes(t *testing.T) {
	// event 0x00EF (239), total IO 0, empty N1..N8, NX=0
	b := mustHex(t, "00ef"+"0000"+"0000"+"0000"+"0000"+"0000"+"0000")
	off, event, io := extractIO8E(b, 0)
	if event != 239 {
		t.Fatalf("event=%v want 239", event)
	}
	if len(io) != 0 {
		t.Fatalf("io=%v", io)
	}
	if off != len(b) {
		t.Fatalf("off=%d want %d", off, len(b))
	}
}

func TestParseAVL_Codec16IO(t *testing.T) {
	// Codec 16: 1 record, GPS same as Codec8 golden, IO: event=239, N1=1 id=239 val=1
	payload := mustHex(t, ""+
		"10"+"01"+
		"0000000000000000"+"00"+
		"3fa86300"+"fc4df480"+"001e"+"005a"+"0c"+"0028"+
		"00ef"+ // event IO 239
		"01"+ // total IO
		"01"+"00ef"+"01"+ // N1: AVL 239 = 1
		"00"+"00"+"00"+ // N2 N4 N8 empty
		"00") // NX count 0
	ts := time.Date(2024, 6, 1, 10, 30, 0, 0, time.UTC)
	binary.BigEndian.PutUint64(payload[2:10], uint64(ts.UnixMilli()))
	n, fixes := parseAVL(payload)
	if n != 1 || len(fixes) != 1 {
		t.Fatalf("n=%d fixes=%d", n, len(fixes))
	}
	if fixes[0].RawAttrs["codec"] != byte(0x10) && fixes[0].RawAttrs["codec"] != 0x10 {
		t.Fatalf("codec=%v", fixes[0].RawAttrs["codec"])
	}
	io, _ := fixes[0].RawAttrs["io"].(map[string]any)
	if io["239"] != int64(1) && io["239"] != 1 {
		t.Fatalf("io=%v", io)
	}
	if fixes[0].Ignition == nil || !*fixes[0].Ignition {
		t.Fatal("expected ignition from io.239")
	}
}

func TestExtractIO16_NX(t *testing.T) {
	// event 0, total 0, empty N1-N8, NX=1 id=1001 len=3 "ABC"
	b := mustHex(t, "0000"+"00"+
		"00"+"00"+"00"+"00"+
		"01"+"03e9"+"0003"+"414243")
	_, _, io := extractIO16(b, 0)
	if io["1001"] != "ABC" {
		t.Fatalf("io=%v", io)
	}
}

func TestExtractIO8E_NXScalarAndASCII(t *testing.T) {
	// event 0, total 0, empty N1..N8, NX count=2:
	// id 1000 len4 = 0x0000002a (42), id 1001 len3 = "ABC"
	b := mustHex(t, "0000"+"0000"+"0000"+"0000"+"0000"+"0000"+
		"0002"+
		"03e8"+"0004"+"0000002a"+
		"03e9"+"0003"+"414243")
	_, _, io := extractIO8E(b, 0)
	if io["1000"] != int64(42) && io["1000"] != 42 {
		t.Fatalf("1000=%v (%T)", io["1000"], io["1000"])
	}
	if io["1001"] != "ABC" {
		t.Fatalf("1001=%v", io["1001"])
	}
}

func TestPromoteTeltonikaScalars(t *testing.T) {
	raw := map[string]any{}
	io := map[string]any{"66": 12000, "67": 3800, "21": 4, "10": 2500}
	promoteTeltonikaScalars(raw, io)
	if raw["voltage.ext"] != 12.0 || raw["voltage.batt"] != 3.8 || raw["gsm.signal"] != 4.0 {
		t.Fatalf("%v", raw)
	}
	if raw["voltage.ain2"] != 2.5 {
		t.Fatalf("ain2=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_BLE(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"25": 215, "29": 55, "86": 90})
	if raw["ble.temp1"] != 21.5 || raw["ble.humidity"] != 55.0 || raw["ble.battery"] != 90.0 {
		t.Fatalf("%v", raw)
	}
	promoteTeltonikaScalars(raw, map[string]any{"27": 180, "28": 190})
	if raw["ble.temp3"] != 18.0 || raw["ble.temp4"] != 19.0 {
		t.Fatalf("temp34=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_DallasTemp(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"72": 25.5, "73": 26.0, "74": 24.0, "75": 23.0})
	if raw["temp.1"] != 25.5 || raw["temp.2"] != 26.0 || raw["temp.3"] != 24.0 || raw["temp.4"] != 23.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_Battery(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"113": 87, "114": 3900})
	if raw["battery.level"] != 87.0 || raw["battery.voltage"] != 3.9 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_SpeedTripOdo(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"24": 62, "199": 5000})
	if raw["speed.io"] != 62.0 || raw["trip.odometer"] != 5000.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_Odometer389(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"389": 12345000})
	if raw["odometer"] != 12345.0 {
		t.Fatalf("389=%v", raw)
	}
	promoteTeltonikaScalars(raw, map[string]any{"16": 99, "389": 12345000})
	if raw["odometer"] != 99.0 {
		t.Fatalf("16 wins=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_GreenDriving(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"253": 3, "243": 12, "15": 85})
	if raw["green_driving.value"] != 3.0 || raw["green_driving.duration"] != 12.0 || raw["eco.score"] != 85.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_Accel(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"17": 100, "18": -20, "19": 980})
	if raw["accel.x"] != 100.0 || raw["accel.y"] != -20.0 || raw["accel.z"] != 980.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_FuelIgnitionOdo(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"89": 75, "239": 1, "16": 12345, "12": 10, "13": 2.5, "48": 1000})
	if raw["fuel.level"] != 75.0 || raw["status.ignition"] != true || raw["odometer"] != 12345.0 {
		t.Fatalf("%v", raw)
	}
	if raw["fuel.used"] != 10.0 || raw["fuel.rate"] != 2.5 || raw["fuel.used_total"] != 1000.0 {
		t.Fatalf("fuel avl=%v", raw)
	}
	raw2 := map[string]any{}
	promoteTeltonikaScalars(raw2, map[string]any{"84": 45.5, "36": 1800, "32": 85, "31": 40})
	if raw2["fuel.volume"] != 45.5 || raw2["engine.rpm"] != 1800.0 {
		t.Fatalf("volume/rpm=%v", raw2)
	}
	if raw2["engine.coolant_temp"] != 85.0 || raw2["engine.load"] != 40.0 {
		t.Fatalf("coolant/load=%v", raw2)
	}
	raw3 := map[string]any{}
	promoteTeltonikaScalars(raw3, map[string]any{"41": 12, "42": 3600, "37": 55, "39": 28})
	if raw3["engine.throttle"] != 12.0 || raw3["engine.runtime"] != 3600.0 {
		t.Fatalf("throttle/runtime=%v", raw3)
	}
	if raw3["speed.obd"] != 55.0 || raw3["engine.intake_temp"] != 28.0 {
		t.Fatalf("obd speed/intake=%v", raw3)
	}
	raw4 := map[string]any{}
	promoteTeltonikaScalars(raw4, map[string]any{"34": 250, "35": 100, "58": 95, "40": 1250})
	if raw4["fuel.pressure"] != 250.0 || raw4["engine.map"] != 100.0 || raw4["engine.oil_temp"] != 95.0 {
		t.Fatalf("map/pressure/oil=%v", raw4)
	}
	if raw4["engine.maf"] != 12.5 {
		t.Fatalf("maf=%v", raw4["engine.maf"])
	}
	raw5 := map[string]any{}
	promoteTeltonikaScalars(raw5, map[string]any{"70": 255, "30": 3, "53": 22, "50": 101, "51": 12500})
	if raw5["pcb.temp"] != 25.5 {
		t.Fatalf("pcb=%v", raw5["pcb.temp"])
	}
	if raw5["obd.dtc_count"] != 3.0 || raw5["engine.ambient_temp"] != 22.0 {
		t.Fatalf("dtc/ambient=%v", raw5)
	}
	if raw5["engine.baro"] != 101.0 || raw5["obd.ecu_voltage"] != 12.5 {
		t.Fatalf("baro/ecu=%v", raw5)
	}
	raw6 := map[string]any{}
	promoteTeltonikaScalars(raw6, map[string]any{"33": -5, "38": 12, "43": 150})
	if raw6["engine.short_fuel_trim"] != -5.0 || raw6["engine.timing_advance"] != 12.0 || raw6["obd.mil_distance"] != 150.0 {
		t.Fatalf("trim/timing/mil=%v", raw6)
	}
	raw7 := map[string]any{}
	promoteTeltonikaScalars(raw7, map[string]any{"44": 250, "45": 30, "56": 40, "46": 10, "47": -2, "54": 60, "55": 120})
	if raw7["fuel.rail_relative"] != 25.0 || raw7["fuel.rail_direct"] != 300.0 || raw7["fuel.rail_absolute"] != 400.0 {
		t.Fatalf("rail=%v", raw7)
	}
	if raw7["engine.egr_commanded"] != 10.0 || raw7["engine.egr_error"] != -2.0 {
		t.Fatalf("egr=%v", raw7)
	}
	if raw7["obd.mil_time"] != 60.0 || raw7["obd.codes_cleared_time"] != 120.0 {
		t.Fatalf("mil time=%v", raw7)
	}
	raw8 := map[string]any{}
	promoteTeltonikaScalars(raw8, map[string]any{"49": 500, "57": 88, "59": 1250})
	if raw8["obd.codes_cleared_distance"] != 500.0 || raw8["hybrid.battery_life"] != 88.0 {
		t.Fatalf("cleared/hybrid=%v", raw8)
	}
	if raw8["engine.injection_timing"] != 12.5 {
		t.Fatalf("injection=%v", raw8["engine.injection_timing"])
	}
	raw9 := map[string]any{}
	promoteTeltonikaScalars(raw9, map[string]any{"60": 850, "68": 2500})
	if raw9["engine.fuel_rate"] != 8.5 || raw9["battery.current"] != 2.5 {
		t.Fatalf("fuel_rate/batt=%v", raw9)
	}
	raw10 := map[string]any{}
	promoteTeltonikaScalars(raw10, map[string]any{"80": 2, "541": 100, "543": 48.5, "544": 65530})
	if raw10["network.data_mode"] != 2.0 || raw10["fuel.air_equivalence"] != 1.0 {
		t.Fatalf("mode/equiv=%v", raw10)
	}
	if raw10["hybrid.system_voltage"] != 48.5 || raw10["hybrid.system_current"] != -6.0 {
		t.Fatalf("hybrid sys=%v", raw10)
	}
	raw11 := map[string]any{}
	promoteTeltonikaScalars(raw11, map[string]any{"237": 3, "205": 12345, "206": 1001, "759": 1})
	if raw11["network.type"] != 3.0 || raw11["gsm.cell_id"] != 12345.0 || raw11["gsm.lac"] != 1001.0 {
		t.Fatalf("net/gsm=%v", raw11)
	}
	if raw11["fuel.type"] != 1.0 {
		t.Fatalf("fuel.type=%v", raw11["fuel.type"])
	}
}

func TestPromoteTeltonikaScalars_SleepIdling(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"200": 1, "251": 1})
	if raw["status.sleeping"] != true || raw["status.idling"] != true {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_DinDout(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"1": 1, "2": 0, "179": 1, "180": 0})
	if raw["status.din1"] != true || raw["status.din2"] != false {
		t.Fatalf("din=%v", raw)
	}
	if raw["status.dout1"] != true || raw["status.dout2"] != false {
		t.Fatalf("dout=%v", raw)
	}
	promoteTeltonikaScalars(raw, map[string]any{"5": 1, "8": 1})
	if raw["status.din5"] != true || raw["status.din8"] != true {
		t.Fatalf("din58=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_GSMOperator(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"241": 51010, "11": 12345})
	if raw["gsm.operator"] != 51010.0 || raw["gsm.iccid"] != "12345" {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_IButton(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"78": "a1b2c3d4", "250": 12.5, "255": 80})
	if raw["ibutton.id"] != "a1b2c3d4" {
		t.Fatalf("%v", raw)
	}
	if raw["trip.distance"] != 12.5 || raw["overspeed.threshold"] != 80.0 {
		t.Fatalf("trip/ov=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_VINRFIDUserFault(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{
		"256": "VF1ABCDEF12345678",
		"207": "rfiddeadbeef",
		"238": "aabbccddeeff",
		"281": "P0300,P0420",
	})
	if raw["vehicle.vin"] != "VF1ABCDEF12345678" || raw["rfid.id"] != "rfiddeadbeef" {
		t.Fatalf("vin/rfid=%v", raw)
	}
	if raw["user.id"] != "aabbccddeeff" || raw["obd.fault_codes"] != "P0300,P0420" {
		t.Fatalf("user/dtc=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_BarcodeBTFuelOEM(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"264": "BC123", "263": 2, "270": 55, "390": 450})
	if raw["barcode.id"] != "BC123" || raw["bt.status"] != 2.0 {
		t.Fatalf("barcode/bt=%v", raw)
	}
	if raw["ble.fuel1"] != 55.0 || raw["fuel.oem_level"] != 45.0 {
		t.Fatalf("ble/oem fuel=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_BLEFuelLLS(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{
		"269": 22, "270": 10, "271": 370, "272": 65531, // -5 as uint16
		"273": 20, "276": 30, "279": 40,
	})
	if raw["ble.fuel_temp1"] != 22.0 || raw["ble.fuel_batt1"] != 3.7 {
		t.Fatalf("lls temp/batt=%v", raw)
	}
	if raw["ble.fuel_temp2"] != -5.0 {
		t.Fatalf("fuel_temp2=%v", raw["ble.fuel_temp2"])
	}
	if raw["ble.fuel2"] != 20.0 || raw["ble.fuel3"] != 30.0 || raw["ble.fuel4"] != 40.0 {
		t.Fatalf("ble fuel 2-4=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_BLEEnvFuelFreq(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{
		"274": 380, "275": 19, "277": 390, "278": 65530, "280": 400, // temp4=-6
		"104": 41, "106": 42, "108": 43,
		"20": 81, "22": 82, "23": 83,
		"306": 100, "307": 101, "308": 102, "309": 103,
	})
	if raw["ble.fuel_batt2"] != 3.8 || raw["ble.fuel_temp3"] != 19.0 || raw["ble.fuel_batt3"] != 3.9 {
		t.Fatalf("lls3=%v", raw)
	}
	if raw["ble.fuel_temp4"] != -6.0 || raw["ble.fuel_batt4"] != 4.0 {
		t.Fatalf("lls4=%v", raw)
	}
	if raw["ble.humidity2"] != 41.0 || raw["ble.humidity3"] != 42.0 || raw["ble.humidity4"] != 43.0 {
		t.Fatalf("humidity=%v", raw)
	}
	if raw["ble.battery2"] != 81.0 || raw["ble.battery3"] != 82.0 || raw["ble.battery4"] != 83.0 {
		t.Fatalf("battery=%v", raw)
	}
	if raw["ble.fuel_freq1"] != 100.0 || raw["ble.fuel_freq4"] != 103.0 {
		t.Fatalf("freq=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_RS232LLSGroundBeacon(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{
		"201": 100, "202": 25, "203": 200, "204": 251, // temp2=-5 as uint8
		"210": 300, "211": 30, "212": 400, "213": 31, "214": 500, "215": 32,
		"381": 1, "385": "aabb",
	})
	if raw["fuel.lls1"] != 100.0 || raw["fuel.lls_temp1"] != 25.0 || raw["fuel.lls2"] != 200.0 {
		t.Fatalf("lls1-2=%v", raw)
	}
	if raw["fuel.lls_temp2"] != -5.0 {
		t.Fatalf("lls_temp2=%v", raw["fuel.lls_temp2"])
	}
	if raw["fuel.lls5"] != 500.0 || raw["fuel.lls_temp5"] != 32.0 {
		t.Fatalf("lls5=%v", raw)
	}
	if raw["ground.sense"] != true || raw["beacon.ids"] != "aabb" {
		t.Fatalf("ground/beacon=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_ISO6709(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"387": "+061212.0000+1064800.0000+000.030/"})
	if raw["gnss.iso6709"] != "+061212.0000+1064800.0000+000.030/" {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_GeofenceZone10(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"65": 1})
	if raw["geofence.zone10"] != 1.0 {
		t.Fatalf("%v", raw)
	}
	if _, ok := raw["odometer"]; ok {
		t.Fatalf("AVL 65 must not map to odometer: %v", raw)
	}
}

func TestPromoteTeltonikaScalars_GeofenceZones1to9(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{
		"155": 1, "156": 0, "157": 3, "158": 2, "159": 1,
		"61": 1, "62": 0, "63": 1, "64": 2,
	})
	if raw["geofence.zone1"] != 1.0 || raw["geofence.zone5"] != 1.0 || raw["geofence.zone9"] != 2.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_BLELuminosityCustom(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{
		"331": 1, "332": 2, "333": 3, "334": 4,
		"335": 10, "336": 20, "337": 30, "338": 40,
		"463": 11, "466": 14, "467": 21, "470": 24,
		"471": 31, "474": 34, "475": 41, "478": 44,
	})
	if raw["ble.custom1_1"] != 1.0 || raw["ble.custom1_4"] != 4.0 {
		t.Fatalf("custom1=%v", raw)
	}
	if raw["ble.luminosity1"] != 10.0 || raw["ble.luminosity4"] != 40.0 {
		t.Fatalf("luminosity=%v", raw)
	}
	if raw["ble.custom2_1"] != 11.0 || raw["ble.custom2_4"] != 14.0 {
		t.Fatalf("custom2=%v", raw)
	}
	if raw["ble.custom3_1"] != 21.0 || raw["ble.custom5_4"] != 44.0 {
		t.Fatalf("custom3-5=%v", raw)
	}
}

func TestPromoteTeltonikaScalars_GNSSQuality(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"181": 15, "182": 12, "69": 1})
	if raw["gnss.pdop"] != 1.5 || raw["gnss.hdop"] != 1.2 || raw["gnss.status"] != 1.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_SafetyStatus(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"246": 1, "247": 1, "249": 1, "252": 1, "240": 1})
	if raw["status.towing"] != true || raw["status.crash"] != true {
		t.Fatalf("%v", raw)
	}
	if raw["status.jamming"] != true || raw["status.unplug"] != true || raw["status.movement"] != true {
		t.Fatalf("%v", raw)
	}
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
