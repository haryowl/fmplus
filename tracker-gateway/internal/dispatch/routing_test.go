package dispatch

import "testing"

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
