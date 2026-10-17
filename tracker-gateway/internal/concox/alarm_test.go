package concox

import (
	"testing"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestExtractAlarmCode(t *testing.T) {
	info := []byte{0x00, 0x00, 0x01, 0x00, 0x01} // SOS near end before language
	code, ok := extractAlarmCode(info)
	if !ok || code != 0x01 {
		t.Fatalf("code=%x ok=%v", code, ok)
	}
}

func TestSafetyFromAlarm(t *testing.T) {
	info := []byte{0x00, 0x06, 0x00, 0x01}
	ev := safetyFromAlarm(info, store.Fix{RecordedAt: time.Now().UTC()})
	if ev == nil || ev.AlarmType != "overspeed" {
		t.Fatalf("ev=%+v", ev)
	}
	if ev.RawAttrs["alarm.overspeed"] != true {
		t.Fatalf("raw=%v", ev.RawAttrs)
	}
}
