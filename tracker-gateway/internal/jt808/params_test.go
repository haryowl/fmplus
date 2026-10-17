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
