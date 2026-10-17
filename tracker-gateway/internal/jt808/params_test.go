package jt808

import (
	"encoding/binary"
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestParseTerminalParams(t *testing.T) {
	// count=1, id=0x0001, len=2, value=0x00A0
	body := []byte{0x01, 0x00, 0x00, 0x00, 0x01, 0x02, 0x00, 0xA0}
	out, ok := parseTerminalParamsOK(body)
	if !ok || out["param_count"] != 1 {
		t.Fatalf("%v ok=%v", out, ok)
	}
	if out["param.0x0001"] != 0xA0 {
		t.Fatalf("param=%v", out["param.0x0001"])
	}
	if out["heartbeat.interval"] != 0xA0 {
		t.Fatalf("hoist=%v", out["heartbeat.interval"])
	}
	// truncated: count=2 but only one TLV
	_, ok = parseTerminalParamsOK([]byte{0x02, 0x00, 0x00, 0x00, 0x01, 0x02, 0x00, 0xA0})
	if ok {
		t.Fatal("expected incomplete")
	}
	up := parseUpgradeResult([]byte{0x00, 0x00})
	if up["upgrade_result"] != 0 {
		t.Fatalf("%v", up)
	}
}

func TestParseMultimediaAndTransparent(t *testing.T) {
	media := make([]byte, 7)
	media[0], media[1], media[2] = 0, 1, 2
	binary.BigEndian.PutUint32(media[3:7], 42)
	m := parseMultimediaMeta(media)
	if m["media_id"] != uint32(42) || m["media_type"] != 0 {
		t.Fatalf("%v", m)
	}
	long := make([]byte, 36)
	binary.BigEndian.PutUint32(long[0:4], 99)
	long[4], long[5], long[6], long[7] = 0, 1, 2, 3
	ml := parseMultimediaMeta(long)
	if ml["media_id"] != uint32(99) || ml["media_channel"] != 3 || ml["media_has_location"] != true {
		t.Fatalf("long=%v", ml)
	}
	if ml["media_code"] != 1 || ml["media_event"] != 2 {
		t.Fatalf("code/event=%v", ml)
	}
	if ml["media_kind"] != "picture" {
		t.Fatalf("kind=%v", ml["media_kind"])
	}
	vid := make([]byte, 8)
	vid[4] = 2
	if parseMultimediaMeta(vid)["media_kind"] != "video" {
		t.Fatalf("video kind=%v", parseMultimediaMeta(vid))
	}
	if loc := multimediaLocationBody(long); len(loc) != 28 {
		t.Fatalf("loc len=%d", len(loc))
	}
	tr := parseTransparent([]byte{0xF0, 'a', 'b'})
	if tr["transparent_type"] != 0xF0 || tr["transparent_hex"] != "6162" {
		t.Fatalf("%v", tr)
	}
	if tr["transparent_kind"] != "vendor" || tr["transparent_text"] != "ab" {
		t.Fatalf("kind/text=%v", tr)
	}
	wb := make([]byte, 4+5)
	binary.BigEndian.PutUint32(wb[0:4], 5)
	copy(wb[4:], "hello")
	w := parseWaybill(wb)
	if w["waybill_text"] != "hello" {
		t.Fatalf("%v", w)
	}
}

func TestQueryAliasesEncode(t *testing.T) {
	ad := Adapter{}
	for _, typ := range []string{"query_params", "query_attrs", "query_location"} {
		out, err := ad.EncodeDownlink(store.Command{CommandType: typ, PayloadText: "all"}, "13800138000")
		if err != nil || len(out) < 5 {
			t.Fatalf("%s: %v %x", typ, err, out)
		}
	}
}

func TestHoistTerminalParam_APNAndReport(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0010, "cmnet", []byte("cmnet"), out)
	hoistTerminalParam(0x0020, 30, nil, out)
	hoistTerminalParam(0x0083, nil, []byte("B12345"), out)
	hoistTerminalParam(0x0055, 80, nil, out)
	if out["apn.main"] != "cmnet" || out["report.interval"] != 30 {
		t.Fatalf("%v", out)
	}
	if out["vehicle.plate"] != "B12345" || out["speed.max"] != 80 {
		t.Fatalf("plate/speed=%v", out)
	}
}

func TestHoistTerminalParam_AlarmMask(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0050, 0x0f, nil, out)
	hoistTerminalParam(0x0051, 0x03, nil, out)
	if out["alarm.mask"] != 0x0f || out["alarm.sms_switch"] != 0x03 {
		t.Fatalf("%v", out)
	}
}

func TestHoistTerminalParam_UDPSMS(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0004, 30, nil, out)
	hoistTerminalParam(0x0005, 3, nil, out)
	hoistTerminalParam(0x0006, 60, nil, out)
	hoistTerminalParam(0x0007, 2, nil, out)
	if out["udp.timeout"] != 30 || out["udp.retry"] != 3 {
		t.Fatalf("udp=%v", out)
	}
	if out["sms.timeout"] != 60 || out["sms.retry"] != 2 {
		t.Fatalf("sms=%v", out)
	}
}

func TestHoistTerminalParam_GNSS(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0090, 3, nil, out)
	hoistTerminalParam(0x0091, 9600, nil, out)
	hoistTerminalParam(0x0092, 1, nil, out)
	hoistTerminalParam(0x0093, 10, nil, out)
	hoistTerminalParam(0x0094, 0xff, nil, out)
	hoistTerminalParam(0x0095, 0x01020304, nil, out)
	if out["gnss.mode"] != 3 || out["gnss.baud"] != 9600 {
		t.Fatalf("%v", out)
	}
	if out["gnss.nmea_out"] != 1 || out["gnss.nmea_collect_freq"] != 10 || out["gnss.nmea_collect"] != 0xff {
		t.Fatalf("nmea=%v", out)
	}
	if out["gnss.upload_set"] != 0x01020304 {
		t.Fatalf("upload=%v", out["gnss.upload_set"])
	}
}

func TestHoistTerminalParam_CANChannels(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0100, 100, nil, out)
	hoistTerminalParam(0x0101, 5, nil, out)
	hoistTerminalParam(0x0102, 200, nil, out)
	hoistTerminalParam(0x0103, 10, nil, out)
	if out["can1.collect_ms"] != 100 || out["can1.upload_s"] != 5 {
		t.Fatalf("can1=%v", out)
	}
	if out["can2.collect_ms"] != 200 || out["can2.upload_s"] != 10 {
		t.Fatalf("can2=%v", out)
	}
}

func TestHoistTerminalParam_PhoneAlarmShoot(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0042, nil, []byte("RESTORE"), out)
	hoistTerminalParam(0x0043, nil, []byte("SMS-PLAT"), out)
	hoistTerminalParam(0x0044, nil, []byte("TTS"), out)
	hoistTerminalParam(0x0045, 1, nil, out)
	hoistTerminalParam(0x0046, 60, nil, out)
	hoistTerminalParam(0x0047, 3600, nil, out)
	hoistTerminalParam(0x0049, nil, []byte("PRIV"), out)
	hoistTerminalParam(0x0052, 0xff, nil, out)
	hoistTerminalParam(0x0054, 0x0f, nil, out)
	if out["phone.restore"] != "RESTORE" || out["phone.sms_platform"] != "SMS-PLAT" {
		t.Fatalf("phone=%v", out)
	}
	if out["phone.tts"] != "TTS" || out["phone.answer_strategy"] != 1 {
		t.Fatalf("tts/answer=%v", out)
	}
	if out["phone.call_max_sec"] != 60 || out["phone.call_month_max"] != 3600 {
		t.Fatalf("call=%v", out)
	}
	if out["phone.privilege"] != "PRIV" {
		t.Fatalf("priv=%v", out)
	}
	if out["alarm.shoot_switch"] != 0xff || out["alarm.shoot_store"] != 0x0f {
		t.Fatalf("shoot=%v", out)
	}
}

func TestHoistTerminalParam_ReportStrategy(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0021, 1, nil, out)
	if out["report.strategy"] != 1 {
		t.Fatalf("%v", out)
	}
}

func TestHoistTerminalParam_InflectionDistance(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0023, 30, nil, out)
	hoistTerminalParam(0x0024, 100, nil, out)
	hoistTerminalParam(0x0030, 500, nil, out)
	hoistTerminalParam(0x0031, 800, nil, out)
	if out["report.inflection_angle"] != 30 || out["report.inflection_distance"] != 100 {
		t.Fatalf("inflection=%v", out)
	}
	if out["report.distance_interval"] != 500 || out["report.distance_interval_night"] != 800 {
		t.Fatalf("distance=%v", out)
	}
}

func TestHoistTerminalParam_UDPCollisionReport(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0019, 7611, nil, out)
	hoistTerminalParam(0x001a, 7612, nil, out)
	hoistTerminalParam(0x0022, 120, nil, out)
	hoistTerminalParam(0x0028, 5, nil, out)
	hoistTerminalParam(0x0053, 10, nil, out)
	hoistTerminalParam(0x0057, 4, nil, out)
	hoistTerminalParam(0x0058, 50, nil, out)
	hoistTerminalParam(0x0059, 30, nil, out)
	if out["server.udp_port"] != 7611 || out["server.udp_port_backup"] != 7612 {
		t.Fatalf("udp=%v", out)
	}
	if out["report.interval_unlogin"] != 120 || out["report.interval_urgent"] != 5 {
		t.Fatalf("report=%v", out)
	}
	if out["speed.warn_delta"] != 10 || out["collision.time"] != 4 ||
		out["collision.accel"] != 50 || out["rollover.angle"] != 30 {
		t.Fatalf("collision=%v", out)
	}
}

func TestHoistTerminalParam_NetworkAndReportVariants(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0001, 60, nil, out)
	hoistTerminalParam(0x0002, 30, nil, out)
	hoistTerminalParam(0x0003, 3, nil, out)
	hoistTerminalParam(0x0010, nil, []byte("cmnet"), out)
	hoistTerminalParam(0x0011, nil, []byte("user"), out)
	hoistTerminalParam(0x0013, nil, []byte("gps.example.com"), out)
	hoistTerminalParam(0x0017, nil, []byte("bak.example.com"), out)
	hoistTerminalParam(0x0018, 7611, nil, out)
	hoistTerminalParam(0x0020, 30, nil, out)
	hoistTerminalParam(0x0027, 300, nil, out)
	hoistTerminalParam(0x0029, 60, nil, out)
	hoistTerminalParam(0x0084, 1, nil, out)
	if out["heartbeat.interval"] != 60 || out["tcp.timeout"] != 30 || out["tcp.retry"] != 3 {
		t.Fatalf("tcp=%v", out)
	}
	if out["apn.main"] != "cmnet" || out["apn.user"] != "user" || out["server.main"] != "gps.example.com" {
		t.Fatalf("apn/server=%v", out)
	}
	if out["server.backup"] != "bak.example.com" || out["server.port"] != 7611 {
		t.Fatalf("backup=%v", out)
	}
	if out["report.interval"] != 30 || out["report.interval_dormant"] != 300 ||
		out["report.interval_default"] != 60 || out["vehicle.plate_color"] != 1 {
		t.Fatalf("report/plate=%v", out)
	}
}

func TestHoistTerminalParam_PhoneSpeedMileageVehicle(t *testing.T) {
	out := map[string]any{}
	hoistTerminalParam(0x0040, nil, []byte("13800138000"), out)
	hoistTerminalParam(0x0041, nil, []byte("*RESET#"), out)
	hoistTerminalParam(0x0048, nil, []byte("SMS"), out)
	hoistTerminalParam(0x0056, 10, nil, out)
	hoistTerminalParam(0x0080, 1.0, nil, out)
	hoistTerminalParam(0x0081, 11, nil, out)
	hoistTerminalParam(0x0082, 101, nil, out)
	if out["phone.monitor"] != "13800138000" || out["phone.reset"] != "*RESET#" || out["phone.sms"] != "SMS" {
		t.Fatalf("phone=%v", out)
	}
	if out["speed.duration"] != 10 || out["mileage.factor"] != 1.0 {
		t.Fatalf("speed/mileage=%v", out)
	}
	if out["vehicle.province"] != 11 || out["vehicle.city"] != 101 {
		t.Fatalf("vehicle=%v", out)
	}
}
