package dispatch

import (
	"testing"

	"github.com/haryowl/fmplus/tracker-gateway/internal/protocol"
)

func TestIsJT808Command(t *testing.T) {
	if !isJT808Command("jt808", "text") {
		t.Fatal("protocol jt808")
	}
	if !isJT808Command("", "query_params") {
		t.Fatal("alias query_params")
	}
	if !isJT808Command("subiao", "jt808_8105") {
		t.Fatal("subiao 8105")
	}
	if isJT808Command("teltonika", "teltonika_codec12") {
		t.Fatal("teltonika should not match")
	}
}

func TestDownlinkCorr_protocols(t *testing.T) {
	// Minimal JT808 escaped frame: 0x7e ... seq ... 0x7e — use empty when not framed.
	if downlinkCorr("teltonika", "teltonika_codec12", nil, nil) != "" {
		t.Fatal("teltonika corr must be empty")
	}
	if downlinkCorr("galileosky", "galileosky_text", nil, nil) != "" {
		t.Fatal("galileosky corr must be empty")
	}
	if downlinkCorr("ruptela", "ruptela_sms", nil, nil) != "108" {
		t.Fatal("ruptela")
	}
	sess := &protocol.ConnSession{Meta: map[string]string{"seq": "9"}}
	if downlinkCorr("other", "raw", nil, sess) != "9" {
		t.Fatal("meta seq fallback")
	}
}
