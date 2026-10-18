package galileosky

import (
	"encoding/binary"
	"testing"
)

func TestApplyStatusTags_SOS_AndMoving(t *testing.T) {
	raw := map[string]any{}
	// bit0 movement + bit15 alarm (SOS)
	st := make([]byte, 2)
	binary.LittleEndian.PutUint16(st, 0x8001)
	evs := applyStatusTags(map[byte][]byte{0x40: st}, raw)
	if raw["status.moving"] != true || raw["alarm.sos"] != true {
		t.Fatalf("raw=%v", raw)
	}
	if len(evs) != 1 || evs[0].AlarmType != "sos" {
		t.Fatalf("evs=%+v", evs)
	}
}

func TestApplyStatusTags_EngineAndPower(t *testing.T) {
	raw := map[string]any{}
	st := make([]byte, 2)
	binary.LittleEndian.PutUint16(st, 0x0100|0x0200) // ext power + engine
	evs := applyStatusTags(map[byte][]byte{0x40: st}, raw)
	if raw["status.ignition"] != true || raw["alarm.power_ext"] != true {
		t.Fatalf("raw=%v", raw)
	}
	if len(evs) != 1 || evs[0].AlarmType != "power_ext" {
		t.Fatalf("evs=%+v", evs)
	}
}

func TestApplyStatusTags_VoltagesTemp(t *testing.T) {
	raw := map[string]any{}
	sup := make([]byte, 2)
	batt := make([]byte, 2)
	binary.LittleEndian.PutUint16(sup, 12400)
	binary.LittleEndian.PutUint16(batt, 3700)
	_ = applyStatusTags(map[byte][]byte{
		0x41: sup,
		0x42: batt,
		0x43: {0x16}, // 22°C
	}, raw)
	if raw["voltage.supply"] != 12.4 || raw["voltage.batt"] != 3.7 {
		t.Fatalf("volt=%v", raw)
	}
	if raw["temp.device"] != float64(22) {
		t.Fatalf("temp=%v", raw)
	}
}

func TestApplyStatusTags_OutputsAndEcoDrive(t *testing.T) {
	raw := map[string]any{}
	_ = applyStatusTags(map[byte][]byte{
		0x45: {0x05, 0x00},
		0x47: {10, 20, 30, 40},
	}, raw)
	if raw["status.dout0"] != true || raw["status.dout2"] != true {
		t.Fatalf("dout=%v", raw)
	}
	if raw["ecodrive.accel"] != 10 || raw["ecodrive.brake"] != 20 {
		t.Fatalf("eco=%v", raw)
	}
}

func TestApplyStatusTags_Impact(t *testing.T) {
	raw := map[string]any{}
	st := make([]byte, 2)
	binary.LittleEndian.PutUint16(st, 0x0400)
	evs := applyStatusTags(map[byte][]byte{0x40: st}, raw)
	if len(evs) != 1 || evs[0].AlarmType != "impact" {
		t.Fatalf("evs=%+v", evs)
	}
}
