package ruptela

import "testing"

func TestRuptelaCmdFailed(t *testing.T) {
	if ruptelaCmdFailed("OK") {
		t.Fatal("OK")
	}
	if !ruptelaCmdFailed("ERROR: bad") {
		t.Fatal("ERROR")
	}
	if !ruptelaCmdFailed("command FAIL") {
		t.Fatal("FAIL")
	}
}
