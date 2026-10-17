package concox

import (
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/store"
)

func TestEncodeDownlink_0x80(t *testing.T) {
	a := Adapter{}
	out, err := a.EncodeDownlink(store.Command{PayloadText: "DYD,000000#"})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) < 15 {
		t.Fatalf("frame too short: %x", out)
	}
	if out[0] != 0x78 || out[1] != 0x78 {
		t.Fatalf("bad start %x", out[:2])
	}
	if out[len(out)-2] != 0x0d || out[len(out)-1] != 0x0a {
		t.Fatalf("bad stop")
	}
	// proto at content start
	if out[3] != 0x80 {
		t.Fatalf("proto=%x want 0x80", out[3])
	}
}

func TestEncodeDownlink_SerialCorr(t *testing.T) {
	out, err := (Adapter{}).EncodeDownlinkSerial(store.Command{PayloadText: "DYD#"}, 42)
	if err != nil {
		t.Fatal(err)
	}
	if DownlinkCorrID(out) != "42" {
		t.Fatalf("corr=%s", DownlinkCorrID(out))
	}
}

func TestBuildFrame_Extended7979(t *testing.T) {
	// packetLen = len(extra)+5; need >255 → extra ≥ 251
	extra := make([]byte, 251)
	for i := range extra {
		extra[i] = byte(i)
	}
	frame := buildFrame(0x80, 7, extra)
	if frame[0] != 0x79 || frame[1] != 0x79 {
		t.Fatalf("want 7979 got %x", frame[:2])
	}
	if DownlinkCorrID(frame) != "7" {
		t.Fatalf("corr=%s", DownlinkCorrID(frame))
	}
}
