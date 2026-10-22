package store

import (
	"context"
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

type gpsPoint struct {
	Lat float64
	Lon float64
	At  time.Time
}

func sumGpsTrackKm(points []gpsPoint) float64 {
	if len(points) < 2 {
		return 0
	}
	total := 0.0
	for i := 1; i < len(points); i++ {
		total += gpsStepKm(points[i-1].Lat, points[i-1].Lon, points[i-1].At, points[i].Lat, points[i].Lon, points[i].At)
	}
	return total
}

func (s *Store) applyGpsOdometer(ctx context.Context, deviceID string, delta float64) {
	if s == nil || s.pool == nil || deviceID == "" {
		return
	}
	if delta > 0 {
		tag, err := s.pool.Exec(ctx, `
			UPDATE tracker_devices
			SET gps_odometer_km = gps_odometer_km + $2
			WHERE id = $1::uuid AND gps_odometer_km IS NOT NULL`, deviceID, delta)
		if err == nil && tag.RowsAffected() > 0 {
			return
		}
		if err != nil {
			return
		}
	}
	s.ensureGpsOdometer(ctx, deviceID)
}

func (s *Store) ensureGpsOdometer(ctx context.Context, deviceID string) {
	if s == nil || s.pool == nil || deviceID == "" {
		return
	}
	var cur *float64
	err := s.pool.QueryRow(ctx, `
		SELECT gps_odometer_km FROM tracker_devices WHERE id = $1::uuid`, deviceID).Scan(&cur)
	if err != nil || cur != nil {
		return
	}
	rows, err := s.pool.Query(ctx, `
		SELECT lat, lon, recorded_at
		FROM vehicle_fixes
		WHERE device_id = $1::uuid
		  AND lat IS NOT NULL AND lon IS NOT NULL
		  AND ABS(lat) >= 0.01 AND ABS(lon) >= 0.01
		ORDER BY recorded_at ASC`, deviceID)
	if err != nil {
		return
	}
	defer rows.Close()
	var points []gpsPoint
	for rows.Next() {
		var p gpsPoint
		if scanErr := rows.Scan(&p.Lat, &p.Lon, &p.At); scanErr != nil {
			continue
		}
		points = append(points, p)
	}
	km := sumGpsTrackKm(points)
	_, _ = s.pool.Exec(ctx, `
		UPDATE tracker_devices
		SET gps_odometer_km = $2
		WHERE id = $1::uuid AND gps_odometer_km IS NULL`, deviceID, km)
}
