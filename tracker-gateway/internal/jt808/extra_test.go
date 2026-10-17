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
	if add["gsm_signal"] != 20 || add["gnss_sats"] != 12 {
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
