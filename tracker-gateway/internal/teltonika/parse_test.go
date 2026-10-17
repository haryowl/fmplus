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
	io := map[string]any{"66": 12000, "67": 3800, "21": 4}
	promoteTeltonikaScalars(raw, io)
	if raw["voltage.ext"] != 12.0 || raw["voltage.batt"] != 3.8 || raw["gsm.signal"] != 4.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_BLE(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"25": 215, "29": 55, "86": 90})
	if raw["ble.temp1"] != 21.5 || raw["ble.humidity"] != 55.0 || raw["ble.battery"] != 90.0 {
		t.Fatalf("%v", raw)
	}
}

func TestPromoteTeltonikaScalars_DallasTemp(t *testing.T) {
	raw := map[string]any{}
	promoteTeltonikaScalars(raw, map[string]any{"72": 25.5, "73": 26.0, "74": 24.0})
	if raw["temp.1"] != 25.5 || raw["temp.2"] != 26.0 || raw["temp.3"] != 24.0 {
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
	promoteTeltonikaScalars(raw, map[string]any{"89": 75, "239": 1, "16": 12345})
	if raw["fuel.level"] != 75.0 || raw["status.ignition"] != true || raw["odometer"] != 12345.0 {
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
