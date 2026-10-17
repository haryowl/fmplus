package ruptela

import "testing"

func TestParseIdentResponse_Labeled(t *testing.T) {
	m := parseIdentResponse("FW:1.2.3;HW:FM-Eco4;CFG:fleet")
	if m["ident.fw"] != "1.2.3" || m["ident.hw"] != "FM-Eco4" || m["ident.cfg"] != "fleet" {
		t.Fatalf("%v", m)
	}
	if m["ident"] != "FW:1.2.3;HW:FM-Eco4;CFG:fleet" {
		t.Fatalf("ident blob missing: %v", m)
	}
}

func TestParseIdentResponse_IMEIModel(t *testing.T) {
	m := parseIdentResponse("IMEI:861234567890123;MODEL:FM-Eco4")
	if m["ident.imei"] != "861234567890123" || m["ident.model"] != "FM-Eco4" {
		t.Fatalf("%v", m)
	}
	if m["proto_msg"] != "ruptela_cmd_3" {
		t.Fatalf("proto=%v", m["proto_msg"])
	}
}

func TestParseIdentResponse_WhitespaceFallback(t *testing.T) {
	m := parseIdentResponse("v9.1 boardA cfgX")
	if m["ident.fw"] != "v9.1" || m["ident.hw"] != "boardA" || m["ident.cfg"] != "cfgX" {
		t.Fatalf("%v", m)
	}
}

func TestParseIdentResponse_Empty(t *testing.T) {
	m := parseIdentResponse("")
	if m["proto_msg"] != "ruptela_cmd_3" || m["ident"] != "" {
		t.Fatalf("%v", m)
	}
}
