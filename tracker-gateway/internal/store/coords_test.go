package store

import "testing"

func TestValidCoords(t *testing.T) {
	cases := []struct {
		lat, lon float64
		ok       bool
	}{
		{0, 0, false},
		{-6.2, 106.8, true},
		{91, 0, false},
		{0, 181, false},
		{-90, 180, true},
		{90, -180, true},
	}
	for _, c := range cases {
		if got := ValidCoords(c.lat, c.lon); got != c.ok {
			t.Fatalf("ValidCoords(%v,%v)=%v want %v", c.lat, c.lon, got, c.ok)
		}
	}
}
