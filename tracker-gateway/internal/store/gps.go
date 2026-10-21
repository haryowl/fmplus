package store

import (
	"math"
	"time"
)

const (
	earthRadiusKm          = 6371.0
	minGpsJumpKm           = 1.5
	maxGpsImpliedSpeedKmh  = 180.0
	nullIslandDeg          = 0.01
)

func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func isNullIsland(lat, lon float64) bool {
	return math.Abs(lat) < nullIslandDeg && math.Abs(lon) < nullIslandDeg
}

func isImpossibleGpsStep(prevLat, prevLon float64, prevAt time.Time, lat, lon float64, at time.Time) bool {
	d := haversineKm(prevLat, prevLon, lat, lon)
	if math.IsNaN(d) || d < minGpsJumpKm {
		return false
	}
	dtMs := at.Sub(prevAt).Milliseconds()
	if dtMs <= 0 {
		return true
	}
	kmh := d / (float64(dtMs) / 3_600_000)
	return kmh > maxGpsImpliedSpeedKmh
}

// gpsStepKm is the jump-filtered haversine between consecutive valid GNSS fixes.
func gpsStepKm(prevLat, prevLon float64, prevAt time.Time, lat, lon float64, at time.Time) float64 {
	if isNullIsland(prevLat, prevLon) || isNullIsland(lat, lon) {
		return 0
	}
	if isImpossibleGpsStep(prevLat, prevLon, prevAt, lat, lon, at) {
		return 0
	}
	d := haversineKm(prevLat, prevLon, lat, lon)
	if math.IsNaN(d) || d <= 0 {
		return 0
	}
	return d
}
