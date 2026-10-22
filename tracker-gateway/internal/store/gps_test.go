package store

import (
	"testing"
	"time"
)

func TestGpsStepKmKeepsHighwayAndDropsTeleport(t *testing.T) {
	t0 := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
	// ~40 km over 30 min is fine.
	d := gpsStepKm(-6.2, 106.8, t0, -6.55, 106.8, t0.Add(30*time.Minute))
	if d < 30 || d > 50 {
		t.Fatalf("highway step=%v", d)
	}
	// 200 km in 4 seconds is a jump.
	jump := gpsStepKm(-6.2, 106.8, t0, -8.0, 106.8, t0.Add(4*time.Second))
	if jump != 0 {
		t.Fatalf("teleport should be 0, got %v", jump)
	}
}

func TestSumGpsTrackKmAddsHighwaySteps(t *testing.T) {
	t0 := time.Date(2026, 10, 21, 8, 0, 0, 0, time.UTC)
	points := []gpsPoint{
		{Lat: -6.2, Lon: 106.8, At: t0},
		{Lat: -6.35, Lon: 106.8, At: t0.Add(20 * time.Minute)},
		{Lat: -6.55, Lon: 106.8, At: t0.Add(50 * time.Minute)},
	}
	d := sumGpsTrackKm(points)
	if d < 30 || d > 50 {
		t.Fatalf("track sum=%v", d)
	}
	if sumGpsTrackKm(points[:1]) != 0 {
		t.Fatalf("single point should be 0")
	}
}
