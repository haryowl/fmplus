package jt808

import (
	"encoding/hex"
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestParseAdditionalInfo_AreaAndSignal(t *testing.T) {
	base := make([]byte, 28)
	// 0x12 in/out area: type, id u32, direction=0 (in)
	// 0x25 signal dword with ACC bit0
	// 0x30 gsm=20, 0x31 sats=12
	// 0x12: type 00, area_id 00000001, dir 00 (in) — then 0x25/0x30/0x31
	tlv, _ := hex.DecodeString("120600000001000025040000000130011431010c")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["alarm.fence_in"] != true {
		t.Fatalf("fence_in missing: %v", add)
	}
	if add["status.acc"] != true {
		t.Fatalf("acc: %v", add)
	}
	if add["gsm_signal"] != 20 || add["gsm.signal"] != 20 || add["gnss_sats"] != 12 || add["gnss.sats"] != 12 {
		t.Fatalf("signal/sats: %v", add)
	}
	dest := map[string]any{}
	hoistLocationTLV(add, dest)
	if dest["gsm_signal"] != 20 || dest["alarm.fence_in"] != true || dest["status.acc"] != true {
		t.Fatalf("hoist=%v", dest)
	}
}

func TestParseAdditionalInfo_MileageFuel(t *testing.T) {
	// 28-byte location stub + TLV 0x01 mileage + 0x02 fuel
	base := make([]byte, 28)
	tlv, _ := hex.DecodeString("0104000003e802020064") // mileage 100.0 (1000/10), fuel 10.0
	body := append(base, tlv...)
	add := parseAdditionalInfo(body)
	if add["0x01"] != 100.0 {
		t.Fatalf("mileage=%v", add["0x01"])
	}
	if add["0x02"] != 10.0 {
		t.Fatalf("fuel=%v", add["0x02"])
	}
	if add["mileage"] != 100.0 || add["fuel.level"] != 10.0 {
		t.Fatalf("named=%v", add)
	}
}

func TestParseAdditionalInfo_IO32AndAD2(t *testing.T) {
	base := make([]byte, 28)
	// 0x2A DWORD 0x0105 (dout1 + din1 + din3); 0x2B DWORD 500 → 5.00
	tlv, _ := hex.DecodeString("2a04000001052b04000001f4")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["status.din1"] != true || add["status.din3"] != true || add["status.dout1"] != true {
		t.Fatalf("io %v", add)
	}
	if add["analog.ad2"] != 5.0 {
		t.Fatalf("ad2=%v", add["analog.ad2"])
	}
}

func TestParseAdditionalInfo_PulseSpeedAndAD(t *testing.T) {
	base := make([]byte, 28)
	// 0x07 WORD 400 → 40.0; 0x19 DWORD 12345 → 123.45
	tlv, _ := hex.DecodeString("07020190190400003039")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["speed.pulse"] != 40.0 {
		t.Fatalf("pulse=%v", add["speed.pulse"])
	}
	if add["analog.ad"] != 123.45 {
		t.Fatalf("ad=%v", add["analog.ad"])
	}
}

func TestParseAdditionalInfo_OilAndCargoTemp(t *testing.T) {
	base := make([]byte, 28)
	// 0x05 DWORD 1234 → 123.4; 0x06 int16 255 → 25.5°C
	tlv, _ := hex.DecodeString("0504000004d2060200ff")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["oil.quantity"] != 123.4 {
		t.Fatalf("oil=%v", add["oil.quantity"])
	}
	if add["temp.cargo"] != 25.5 {
		t.Fatalf("temp=%v", add["temp.cargo"])
	}
}

func TestParseAdditionalInfo_ManualAlarmID(t *testing.T) {
	base := make([]byte, 28)
	// 0x04 len=2 id=1 (SOS)
	tlv, _ := hex.DecodeString("04020001")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["manual_alarm_id"] != 1 || add["alarm.sos"] != true {
		t.Fatalf("%v", add)
	}
	dest := map[string]any{}
	hoistLocationTLV(add, dest)
	if dest["manual_alarm_id"] != 1 || dest["alarm.sos"] != true {
		t.Fatalf("hoist=%v", dest)
	}
	ev := safetyFromAdditional(add, store.Fix{Lat: 1, Lon: 2, RecordedAt: time.Now().UTC()}, "jt808")
	if ev == nil || ev.AlarmType != "sos" {
		t.Fatalf("safety=%+v", ev)
	}
}

func TestSafetyFromLocationTLVAlarms_Fence(t *testing.T) {
	add := map[string]any{"alarm.fence_in": true, "area_id": 9}
	ev := safetyFromLocationTLVAlarms(add, store.Fix{Lat: -6, Lon: 106, RecordedAt: time.Now().UTC()}, "jt808")
	if ev == nil || ev.AlarmType != "fence_in" || ev.RawAttrs["area_id"] != 9 {
		t.Fatalf("%+v", ev)
	}
}

func TestParseAdditionalInfo_Signal025Turns(t *testing.T) {
	base := make([]byte, 28)
	// ACC + left turn + brake + low beam: bits 0,1,4,8 → 0x00000113
	tlv, _ := hex.DecodeString("250400000113")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["status.acc"] != true || add["status.left_turn"] != true || add["status.brake"] != true {
		t.Fatalf("%v", add)
	}
	if add["status.low_beam"] != true || add["status.right_turn"] != false {
		t.Fatalf("beams/turn=%v", add)
	}
}

func TestParseAdditionalInfo_DriverIC32(t *testing.T) {
	base := make([]byte, 28)
	// status=1 login, time BCD 6 bytes, result=0, nameLen=3 "Bob", card "IC99" (len=16)
	tlv, _ := hex.DecodeString("3210012601011201000003426f6249433939")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["driver.ic_login"] != true || add["driver.ic_status"] != 1 {
		t.Fatalf("login=%v", add)
	}
	if add["driver.ic_name"] != "Bob" || add["driver.ic_card"] != "IC99" {
		t.Fatalf("name/card=%v", add)
	}
	ev := safetyFromLocationTLVAlarms(add, store.Fix{Lat: 1, Lon: 2, RecordedAt: time.Now().UTC()}, "jt808")
	if ev == nil || ev.AlarmType != "driver_ic_login" {
		t.Fatalf("safety=%+v", ev)
	}
}

func TestParseAdditionalInfo_RouteTimeAndIO(t *testing.T) {
	base := make([]byte, 28)
	// 0x13: loc=1, route_id=7, result=1 (too long), time=120
	// 0x18: IO status 0x0005 (din1+din3)
	tlv, _ := hex.DecodeString("1308010000000701007818020005")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["alarm.route_time_long"] != true || add["route_id"] != 7 || add["route_drive_time"] != 120 {
		t.Fatalf("route=%v", add)
	}
	if add["status.din1"] != true || add["status.din3"] != true || add["status.din2"] != false {
		t.Fatalf("io=%v", add)
	}
}

func TestParseAdditionalInfo_VideoLoss(t *testing.T) {
	base := make([]byte, 28)
	// 0x15 len=4 value=00000003 (ch0+ch1 loss)
	tlv, _ := hex.DecodeString("150400000003")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["alarm.video_loss"] != true || add["video.signal_loss"] != uint32(3) {
		t.Fatalf("%v", add)
	}
	ev := safetyFromAdditional(add, store.Fix{Lat: 1, Lon: 2, RecordedAt: time.Now().UTC()}, "jt808")
	if ev == nil || ev.AlarmType != "video_loss" {
		t.Fatalf("%+v", ev)
	}
}

func TestDecodeVideoAlarmWord(t *testing.T) {
	add := map[string]any{}
	decodeVideoAlarmWord(0x05, add) // loss + storage bits
	if add["alarm.video_loss"] != true || add["alarm.video_storage"] != true {
		t.Fatalf("%v", add)
	}
	add2 := map[string]any{}
	decodeVideoAlarmWord(0x78, add2) // overload|encode|illegal_access|other_device bits 3–6
	if add2["alarm.video_other_device"] != true || add2["alarm.video_overload"] != true ||
		add2["alarm.video_encode"] != true || add2["alarm.video_illegal_access"] != true {
		t.Fatalf("%v", add2)
	}
	add3 := map[string]any{}
	decodeVideoAlarmWord(0x80, add3) // bit7 storage fault
	if add3["alarm.video_storage_fault"] != true {
		t.Fatalf("fault=%v", add3)
	}
}

func TestSafetyFromAdditional_SuBiao(t *testing.T) {
	add := map[string]any{
		"subiao_type":  "0x64",
		"subiao_level": 2,
		"subiao_event": "fcw",
		"adas.fcw":     true,
		"0x64":         "0102",
	}
	fix := store.Fix{Lat: -6.2, Lon: 106.8, RecordedAt: time.Now().UTC()}
	ev := safetyFromAdditional(add, fix, "subiao")
	if ev == nil || ev.AlarmType != "adas_fcw" || ev.AlarmLevel != 2 {
		t.Fatalf("ev=%+v", ev)
	}
	if ev.RawAttrs["adas.fcw"] != true {
		t.Fatalf("raw=%v", ev.RawAttrs)
	}
}

func TestDecodeSubiaoBody_ADAS_FCW(t *testing.T) {
	add := map[string]any{}
	decodeSubiaoBody(0x64, []byte{0x01, 0x02}, add) // type=FCW, level=2
	if add["subiao_level"] != 2 || add["adas.fcw"] != true || add["subiao_event"] != "fcw" {
		t.Fatalf("add=%v", add)
	}
}

func TestDecodeSubiaoBody_DSM_Phone(t *testing.T) {
	add := map[string]any{}
	decodeSubiaoBody(0x65, []byte{0x02, 0x01}, add)
	if add["dsm.phone"] != true || add["subiao_event"] != "phone" {
		t.Fatalf("add=%v", add)
	}
}

func TestDecodeSubiaoBody_BSD(t *testing.T) {
	add := map[string]any{}
	decodeSubiaoBody(0x67, []byte{0x02, 0x01}, add)
	if add["bsd.left"] != true || add["bsd.blind"] != true {
		t.Fatalf("add=%v", add)
	}
}

func TestSafetyFromAlarmWord_SOS(t *testing.T) {
	fix := store.Fix{Lat: -6.2, Lon: 106.8, RecordedAt: time.Now().UTC()}
	ev := safetyFromAlarmWord(1, fix, "jt808") // bit0 SOS
	if ev == nil || ev.AlarmType != "sos" || ev.AlarmLevel != 2 {
		t.Fatalf("ev=%+v", ev)
	}
	if ev.RawAttrs["alarm.sos"] != true {
		t.Fatalf("raw=%v", ev.RawAttrs)
	}
	if safetyFromAlarmWord(0, fix, "jt808") != nil {
		t.Fatal("expected nil for zero alarm")
	}
}

func TestFlattenAlarmBits_OnFix(t *testing.T) {
	raw := map[string]any{}
	flattenAlarmBits(1<<0|1<<1, raw) // sos + overspeed
	if raw["alarm.sos"] != true || raw["alarm.overspeed"] != true {
		t.Fatalf("raw=%v", raw)
	}
	flattenAlarmBits(0, raw)
	if len(raw) != 2 {
		t.Fatalf("zero alarm should not clear existing keys: %v", raw)
	}
}

func TestFlattenAlarmBits_CameraAndDayDrive(t *testing.T) {
	raw := map[string]any{}
	flattenAlarmBits(1<<11|1<<16, raw)
	if raw["alarm.camera_fault"] != true || raw["alarm.day_drive_timeout"] != true {
		t.Fatalf("%v", raw)
	}
}
