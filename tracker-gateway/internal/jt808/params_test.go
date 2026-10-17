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
	tr := parseTransparent([]byte{0xF0, 'a', 'b'})
	if tr["transparent_type"] != 0xF0 || tr["transparent_hex"] != "6162" {
		t.Fatalf("%v", tr)
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
