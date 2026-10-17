package jt808

import (
	"encoding/hex"
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

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

func TestSafetyFromAdditional_SuBiao(t *testing.T) {
	add := map[string]any{
		"subiao_type":  "0x64",
		"subiao_level": 2,
		"0x64":         "0201",
	}
	fix := store.Fix{Lat: -6.2, Lon: 106.8, RecordedAt: time.Now().UTC()}
	ev := safetyFromAdditional(add, fix, "subiao")
	if ev == nil || ev.AlarmType != "adas" || ev.AlarmLevel != 2 {
		t.Fatalf("ev=%+v", ev)
	}
}
