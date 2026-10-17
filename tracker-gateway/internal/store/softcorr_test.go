package store

import "testing"

func TestSoftTextCorr(t *testing.T) {
	if SoftTextCorr("") != "" {
		t.Fatal("empty")
	}
	if SoftTextCorr("  getver  ") != "txt:GETVER" {
		t.Fatalf("got=%q", SoftTextCorr("  getver  "))
	}
	if SoftTextFromCorr("txt:GETVER") != "GETVER" {
		t.Fatal("from")
	}
	if SoftTextFromCorr("108") != "" {
		t.Fatal("non-soft")
	}
}
