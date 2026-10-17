package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Device struct {
	ID               string
	TenantID         string
	IMEI             string
	Protocol         string
	ProfileID        *string
	ArmadaUserID     *int
	TelematicsSource string
	Enabled          bool
}

type Fix struct {
	Lat            float64
	Lon            float64
	RecordedAt     time.Time
	Speed          *float64
	Heading        *float64
	Ignition       *bool
	Odometer       *float64
	Altitude       *float64
	Satellites     *int
	SourceProtocol string
	RawAttrs       map[string]any
	MappedAttrs    map[string]any
}

type Store struct {
	pool *pgxpool.Pool
}

func Connect(ctx context.Context, databaseURL string) (*Store, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func (s *Store) FindByIMEI(ctx context.Context, imei string) (*Device, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT d.id::text, d.tenant_id::text, d.imei, d.protocol, d.profile_id::text,
		       d.armada_user_id, COALESCE(t.telematics_source, 'both'), d.enabled
		FROM tracker_devices d
		JOIN tenants t ON t.id = d.tenant_id
		WHERE d.imei = $1 AND d.enabled = true AND t.enabled = true
		LIMIT 1`, imei)
	var d Device
	var armada *int
	var profileID *string
	if err := row.Scan(&d.ID, &d.TenantID, &d.IMEI, &d.Protocol, &profileID,
		&armada, &d.TelematicsSource, &d.Enabled); err != nil {
		// Fallback before migration 050 (no profile_id column).
		row2 := s.pool.QueryRow(ctx, `
			SELECT d.id::text, d.tenant_id::text, d.imei, d.protocol,
			       d.armada_user_id, COALESCE(t.telematics_source, 'both'), d.enabled
			FROM tracker_devices d
			JOIN tenants t ON t.id = d.tenant_id
			WHERE d.imei = $1 AND d.enabled = true AND t.enabled = true
			LIMIT 1`, imei)
		if err2 := row2.Scan(&d.ID, &d.TenantID, &d.IMEI, &d.Protocol,
			&armada, &d.TelematicsSource, &d.Enabled); err2 != nil {
			return nil, err
		}
		d.ArmadaUserID = armada
		return &d, nil
	}
	if profileID != nil && *profileID != "" {
		d.ProfileID = profileID
	}
	d.ArmadaUserID = armada
	return &d, nil
}

// TouchUnassigned records an unknown IMEI for Admin claim (upsert hit count).
func (s *Store) TouchUnassigned(ctx context.Context, imei, protocol, remote string) {
	if imei == "" {
		return
	}
	if protocol == "" {
		protocol = "other"
	}
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO tracker_unassigned (imei, protocol, last_remote, hit_count, first_seen_at, last_seen_at)
		VALUES ($1, $2, $3, 1, now(), now())
		ON CONFLICT (imei) DO UPDATE SET
			protocol = EXCLUDED.protocol,
			last_remote = EXCLUDED.last_remote,
			hit_count = tracker_unassigned.hit_count + 1,
			last_seen_at = now()`,
		imei, protocol, remote,
	)
}

func (s *Store) FindByTokenHash(ctx context.Context, tokenHash string) (*Device, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT d.id::text, d.tenant_id::text, d.imei, d.protocol, d.profile_id::text,
		       d.armada_user_id, COALESCE(t.telematics_source, 'both'), d.enabled
		FROM tracker_devices d
		JOIN tenants t ON t.id = d.tenant_id
		WHERE d.auth_token_hash = $1 AND d.enabled = true AND t.enabled = true
		LIMIT 1`, tokenHash)
	var d Device
	var armada *int
	var profileID *string
	if err := row.Scan(&d.ID, &d.TenantID, &d.IMEI, &d.Protocol, &profileID,
		&armada, &d.TelematicsSource, &d.Enabled); err != nil {
		return nil, err
	}
	if profileID != nil && *profileID != "" {
		d.ProfileID = profileID
	}
	d.ArmadaUserID = armada
	return &d, nil
}

func acceptsDevices(source string) bool {
	return source == "devices" || source == "both" || source == ""
}

func (s *Store) Ingest(ctx context.Context, device *Device, fix Fix) error {
	if device == nil {
		return fmt.Errorf("device required")
	}
	if !acceptsDevices(device.TelematicsSource) {
		return fmt.Errorf("tenant telematics_source does not accept devices")
	}
	if fix.RecordedAt.IsZero() {
		fix.RecordedAt = time.Now().UTC()
	}
	if fix.SourceProtocol == "" {
		fix.SourceProtocol = device.Protocol
	}
	if fix.RawAttrs == nil {
		fix.RawAttrs = map[string]any{}
	}
	// Device Manager remap: vendor raw → canonical mapped attrs + typed columns.
	if rules, err := s.LoadRemapRules(ctx, device.ID, device.ProfileID); err == nil && len(rules) > 0 {
		fix.MappedAttrs = ApplyRemap(fix.RawAttrs, rules)
		ApplyMappedToTyped(&fix, fix.MappedAttrs)
	}
	if fix.MappedAttrs == nil {
		fix.MappedAttrs = map[string]any{}
	}
	raw, _ := json.Marshal(fix.RawAttrs)
	mapped, _ := json.Marshal(fix.MappedAttrs)

	_, err := s.pool.Exec(ctx, `
		INSERT INTO vehicle_fixes (
			tenant_id, device_id, recorded_at, lat, lon, speed, heading, ignition,
			odometer, altitude, satellites, raw_attrs, mapped_attrs, source_protocol
		) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`,
		device.TenantID, device.ID, fix.RecordedAt, fix.Lat, fix.Lon,
		fix.Speed, fix.Heading, fix.Ignition, fix.Odometer, fix.Altitude, fix.Satellites,
		string(raw), string(mapped), fix.SourceProtocol,
	)
	if err != nil {
		return err
	}

	_, err = s.pool.Exec(ctx, `
		INSERT INTO vehicle_last_fix (
			device_id, tenant_id, recorded_at, lat, lon, speed, heading, ignition,
			odometer, altitude, satellites, raw_attrs, mapped_attrs, source_protocol, updated_at
		) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14, now())
		ON CONFLICT (device_id) DO UPDATE SET
			recorded_at = EXCLUDED.recorded_at,
			lat = EXCLUDED.lat,
			lon = EXCLUDED.lon,
			speed = EXCLUDED.speed,
			heading = EXCLUDED.heading,
			ignition = EXCLUDED.ignition,
			odometer = EXCLUDED.odometer,
			altitude = EXCLUDED.altitude,
			satellites = EXCLUDED.satellites,
			raw_attrs = EXCLUDED.raw_attrs,
			mapped_attrs = EXCLUDED.mapped_attrs,
			source_protocol = EXCLUDED.source_protocol,
			updated_at = now()
		WHERE vehicle_last_fix.recorded_at <= EXCLUDED.recorded_at`,
		device.ID, device.TenantID, fix.RecordedAt, fix.Lat, fix.Lon,
		fix.Speed, fix.Heading, fix.Ignition, fix.Odometer, fix.Altitude, fix.Satellites,
		string(raw), string(mapped), fix.SourceProtocol,
	)
	if err != nil {
		return err
	}

	_, err = s.pool.Exec(ctx, `
		UPDATE tracker_devices
		SET last_seen_at = GREATEST(COALESCE(last_seen_at, $3), $3), updated_at = now()
		WHERE id = $1::uuid AND tenant_id = $2::uuid`,
		device.ID, device.TenantID, fix.RecordedAt,
	)
	return err
}

func (s *Store) PruneFixes(ctx context.Context, days int) (int64, error) {
	if days < 1 {
		days = 14
	}
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM vehicle_fixes
		WHERE recorded_at < now() - ($1::text || ' days')::interval`, fmt.Sprintf("%d", days))
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
