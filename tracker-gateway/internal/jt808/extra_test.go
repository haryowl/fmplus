package jt808

import (
	"encoding/hex"
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestParseAdditionalInfo_AreaAndSignal(t *testing.T) {
	base := make([]byte, 28)
	// 0x12 in/out area; 0x25 Table 31 bit0 = low beam; 0x30 gsm; 0x31 sats
	tlv, _ := hex.DecodeString("120600000001000025040000000130011431010c")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["alarm.fence_in"] != true {
		t.Fatalf("fence_in missing: %v", add)
	}
	if add["area_loc_type"] != 0 || add["area_id"] != 256 || add["area_direction"] != 0 {
		t.Fatalf("area=%v", add)
	}
	if add["status.low_beam"] != true {
		t.Fatalf("low_beam: %v", add)
	}
	if add["gsm_signal"] != 20 || add["gsm.signal"] != 20 || add["gnss_sats"] != 12 || add["gnss.sats"] != 12 {
		t.Fatalf("signal/sats: %v", add)
	}
	dest := map[string]any{}
	hoistLocationTLV(add, dest)
	if dest["gsm_signal"] != 20 || dest["alarm.fence_in"] != true || dest["status.low_beam"] != true {
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
	// 0x2A WORD 0x0003 (deep sleep + sleep); 0x2B AD0=500 AD1=1 → packed 0x000101f4
	tlv, _ := hex.DecodeString("2a0200032b04000101f4")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["status.deep_sleep"] != true || add["status.sleep"] != true {
		t.Fatalf("io %v", add)
	}
	if add["analog.ad0"] != 500.0 || add["analog.ad1"] != 1.0 {
		t.Fatalf("ad=%v ad0=%v ad1=%v", add["analog.ad"], add["analog.ad0"], add["analog.ad1"])
	}
}

func TestParseAdditionalInfo_PulseSpeedAndAD(t *testing.T) {
	base := make([]byte, 28)
	// 0x07 WORD 400 → 40.0; 0x2B AD0=12345
	tlv, _ := hex.DecodeString("070201902b0400003039")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["speed.pulse"] != 40.0 {
		t.Fatalf("pulse=%v", add["speed.pulse"])
	}
	if add["analog.ad0"] != 12345.0 {
		t.Fatalf("ad=%v", add["analog.ad0"])
	}
}

func TestParseAdditionalInfo_OilAndCargoTemp(t *testing.T) {
	base := make([]byte, 28)
	// 0x05 short DWORD oil fallback 1234 → 123.4; 0x06 int16 25 °C (2019 unit is °C)
	tlv, _ := hex.DecodeString("0504000004d206020019")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["oil.quantity"] != 123.4 {
		t.Fatalf("oil=%v", add["oil.quantity"])
	}
	if add["temp.cargo"] != 25.0 {
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

func TestHoistLocationStatusBits_SouthWestEncrypted(t *testing.T) {
	raw := map[string]any{}
	hoistLocationStatusBits(0x04|0x08|0x20, raw) // south + west + encrypted
	if raw["status.south"] != true || raw["status.west"] != true || raw["status.encrypted"] != true {
		t.Fatalf("%v", raw)
	}
}

func TestParseAdditionalInfo_Signal025Turns(t *testing.T) {
	base := make([]byte, 28)
	// Table 31: low_beam(0)+left_turn(3)+brake(4)+reverse(5)+horn(8) → 0x00000139
	tlv, _ := hex.DecodeString("250400000139")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["status.low_beam"] != true || add["status.left_turn"] != true || add["status.brake"] != true {
		t.Fatalf("%v", add)
	}
	if add["status.reverse"] != true || add["status.horn"] != true {
		t.Fatalf("reverse/horn=%v", add)
	}
	if add["status.right_turn"] != false {
		t.Fatalf("beams/turn=%v", add)
	}
	tlv2, _ := hex.DecodeString("250400000003") // low + high beam
	add2 := parseAdditionalInfo(append(base, tlv2...))
	if add2["status.high_beam"] != true || add2["status.low_beam"] != true {
		t.Fatalf("beams=%v", add2)
	}
}

func TestParseAdditionalInfo_IO2A_Sleep(t *testing.T) {
	base := make([]byte, 28)
	tlv, _ := hex.DecodeString("2a020001") // deep sleep only
	add := parseAdditionalInfo(append(base, tlv...))
	if add["status.deep_sleep"] != true || add["status.sleep"] != false {
		t.Fatalf("sleep=%v", add)
	}
}

func TestParseAdditionalInfo_IO2A_BothSleep(t *testing.T) {
	base := make([]byte, 28)
	tlv, _ := hex.DecodeString("2a020003")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["status.deep_sleep"] != true || add["status.sleep"] != true {
		t.Fatalf("sleep=%v", add)
	}
}

func TestParseAdditionalInfo_IO18_ReservedRaw(t *testing.T) {
	base := make([]byte, 28)
	// 0x18 reserved in 808-2019 — raw only, no din/dout invention
	tlv, _ := hex.DecodeString("18020110")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["0x18"] != 0x0110 {
		t.Fatalf("raw=%v", add)
	}
	if add["status.din5"] != nil || add["io.status"] != nil {
		t.Fatalf("should not invent din/io from reserved 0x18: %v", add)
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
	if add["driver.ic_result"] != 0 {
		t.Fatalf("result=%v", add["driver.ic_result"])
	}
	if add["driver.ic_time_bcd"] != "260101120100" {
		t.Fatalf("bcd=%v", add["driver.ic_time_bcd"])
	}
	if add["driver.ic_time"] != "2026-01-01T12:01:00Z" {
		t.Fatalf("ic_time=%v", add["driver.ic_time"])
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
	// 0x13 Table 30: segment_id=7, time=120, result=1 (too long); 0x2A sleep bit1
	tlv, _ := hex.DecodeString("1307000000070078012a020002")
	add := parseAdditionalInfo(append(base, tlv...))
	if add["alarm.route_time_long"] != true || add["route_id"] != 7 || add["route_drive_time"] != 120 {
		t.Fatalf("route=%v", add)
	}
	if add["0x13"] != 1 || add["status.sleep"] != true {
		t.Fatalf("raw tlv keys=%v", add)
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
	other := map[string]any{"alarm.video_other_device": true}
	ev := safetyFromVideoAdditional(other, store.Fix{Lat: 1, Lon: 2, RecordedAt: time.Now().UTC()}, "jt808")
	if ev == nil || ev.AlarmType != "video_other_device" {
		t.Fatalf("safety=%+v", ev)
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

func TestDecodeSubiaoBody_ADAS_Extended(t *testing.T) {
	cases := []struct {
		typ byte
		key string
	}{
		{5, "adas.lane_change"},
		{6, "adas.road_sign"},
		{7, "adas.obstacle"},
		{99, "adas.other"},
	}
	for _, c := range cases {
		add := map[string]any{}
		decodeSubiaoBody(0x64, []byte{c.typ, 0x01}, add)
		if add[c.key] != true {
			t.Fatalf("type=%d add=%v", c.typ, add)
		}
	}
}

func TestDecodeSubiaoBody_DSM_Phone(t *testing.T) {
	add := map[string]any{}
	decodeSubiaoBody(0x65, []byte{0x02, 0x01}, add)
	if add["dsm.phone"] != true || add["subiao_event"] != "phone" {
		t.Fatalf("add=%v", add)
	}
}

func TestDecodeSubiaoBody_DSM_Extended(t *testing.T) {
	add := map[string]any{}
	decodeSubiaoBody(0x65, []byte{0x05, 0x01}, add)
	if add["dsm.driver"] != true {
		t.Fatalf("driver=%v", add)
	}
	add2 := map[string]any{}
	decodeSubiaoBody(0x65, []byte{0x63, 0x01}, add2)
	if add2["dsm.other"] != true {
		t.Fatalf("other=%v", add2)
	}
}

func TestDecodeSubiaoBody_TPMS(t *testing.T) {
	add := map[string]any{}
	decodeSubiaoBody(0x66, []byte{0x01, 0x01}, add)
	if add["tpms.alarm"] != true || add["subiao_event"] != "tpms" {
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
	if ev.RawAttrs["alarm_word"] != uint32(1) && ev.RawAttrs["alarm_word"] != 1 {
		t.Fatalf("alarm_word=%v", ev.RawAttrs["alarm_word"])
	}
	if ev.RawAttrs["alarm_level"] != 2 {
		t.Fatalf("alarm_level=%v", ev.RawAttrs["alarm_level"])
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
	flattenAlarmBits(1<<11|1<<18, raw) // camera + day drive (Table 25)
	if raw["alarm.camera_fault"] != true || raw["alarm.day_drive_timeout"] != true {
		t.Fatalf("%v", raw)
	}
}

func TestFlattenAlarmBits_Tier2(t *testing.T) {
	raw := map[string]any{}
	flattenAlarmBits(1<<3|1<<6|1<<27, raw) // danger_driving + gnss_short + illegal_ignition
	if raw["alarm.danger_driving"] != true || raw["alarm.gnss_short"] != true ||
		raw["alarm.illegal_ignition"] != true {
		t.Fatalf("%v", raw)
	}
}

func TestHoistLocationStatusBits(t *testing.T) {
	raw := map[string]any{}
	HoistLocationStatusBits(0x10|0x100|0x100000|0x200000, raw)
	if raw["status.out_of_service"] != true || raw["vehicle.load"] != "half" ||
		raw["status.load_half"] != true {
		t.Fatalf("load=%v", raw)
	}
	if raw["status.gnss_glonass"] != true || raw["status.gnss_galileo"] != true {
		t.Fatalf("gnss=%v", raw)
	}
	raw2 := map[string]any{}
	HoistLocationStatusBits(0x200, raw2) // bits 8–9 = 10 → reserved
	if raw2["vehicle.load"] != "reserved" || raw2["status.load_reserved"] != true {
		t.Fatalf("reserved=%v", raw2)
	}
}
