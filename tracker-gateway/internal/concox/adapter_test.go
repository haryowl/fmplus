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
