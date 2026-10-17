package jt1078

import "testing"

func TestExtractSIMHint(t *testing.T) {
	if got := extractSIMHint([]byte("13800138000abc")); got != "13800138000" {
		t.Fatalf("got=%q", got)
	}
	if extractSIMHint([]byte("short99")) != "" {
		t.Fatal("expected empty for short digit run")
	}
	if extractSIMHint([]byte{0x00, 0x01, '1', '3', '8', '0', '0', '1', '3', '8', '0', '0', '0'}) != "13800138000" {
		t.Fatal("expected digits after binary prefix")
	}
}
