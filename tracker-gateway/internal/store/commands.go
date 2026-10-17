package store

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/haryowl/fmplus/tracker-gateway/internal/metrics"
)

type Command struct {
	ID          string
	DeviceID    string
	TenantID    string
	Protocol    string
	CommandType string
	PayloadText string
	PayloadHex  string
	CreatedAt   time.Time
}

type SafetyEvent struct {
	RecordedAt     time.Time
	AlarmType      string
	AlarmLevel     int
	Lat            *float64
	Lon            *float64
	AttachmentID   string
	RawAttrs       map[string]any
	MappedAttrs    map[string]any
	SourceProtocol string
}

func (c Command) PayloadBytes() []byte {
	if c.PayloadHex != "" {
		b, err := hex.DecodeString(c.PayloadHex)
		if err == nil {
			return b
		}
	}
	return []byte(c.PayloadText)
}

func scanCommand(row interface{ Scan(dest ...any) error }) (*Command, error) {
	var c Command
	if err := row.Scan(&c.ID, &c.DeviceID, &c.TenantID, &c.Protocol, &c.CommandType,
		&c.PayloadText, &c.PayloadHex, &c.CreatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

// NextPendingCommand atomically claims the oldest pending command for a device
// (pending→sent) so dispatch and session flush cannot double-send.
func (s *Store) NextPendingCommand(ctx context.Context, deviceID string) (*Command, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE tracker_commands c
		SET status = 'sent', sent_at = now()
		WHERE c.id = (
			SELECT id FROM tracker_commands
			WHERE device_id = $1::uuid AND status = 'pending'
			ORDER BY created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING c.id::text, c.device_id::text, c.tenant_id::text, c.protocol, c.command_type,
		          c.payload_text, c.payload_hex, c.created_at`, deviceID)
	c, err := scanCommand(row)
	if err != nil {
		return nil, err
	}
	metrics.CommandSent()
	return c, nil
}

// ClaimNextPendingCommand claims the globally oldest pending command (dispatch loop).
func (s *Store) ClaimNextPendingCommand(ctx context.Context) (*Command, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE tracker_commands c
		SET status = 'sent', sent_at = now()
		WHERE c.id = (
			SELECT id FROM tracker_commands
			WHERE status = 'pending'
			ORDER BY created_at ASC
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING c.id::text, c.device_id::text, c.tenant_id::text, c.protocol, c.command_type,
		          c.payload_text, c.payload_hex, c.created_at`)
	c, err := scanCommand(row)
	if err != nil {
		return nil, err
	}
	metrics.CommandSent()
	return c, nil
}

// ClaimCommand claims a specific pending command by id (peek-then-claim dispatch).
func (s *Store) ClaimCommand(ctx context.Context, commandID string) (*Command, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE tracker_commands
		SET status = 'sent', sent_at = now()
		WHERE id = $1::uuid AND status = 'pending'
		RETURNING id::text, device_id::text, tenant_id::text, protocol, command_type,
		          payload_text, payload_hex, created_at`, commandID)
	c, err := scanCommand(row)
	if err != nil {
		return nil, err
	}
	metrics.CommandSent()
	return c, nil
}

// ListPendingCommands returns up to limit pending rows without claiming (Admin / metrics).
func (s *Store) ListPendingCommands(ctx context.Context, limit int) ([]Command, error) {
	if limit < 1 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id::text, device_id::text, tenant_id::text, protocol, command_type,
		       payload_text, payload_hex, created_at
		FROM tracker_commands
		WHERE status = 'pending'
		ORDER BY created_at ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Command
	for rows.Next() {
		c, err := scanCommand(rows)
		if err != nil {
			continue
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (s *Store) MarkCommandSent(ctx context.Context, commandID string) error {
	return s.MarkCommandSentCorr(ctx, commandID, "")
}

// MarkCommandSentCorr sets corr_id on an already-claimed (sent) command after wire write.
// Also accepts pending→sent for legacy callers that have not claimed yet.
// Metrics are counted only on pending→sent (claim paths already call CommandSent).
func (s *Store) MarkCommandSentCorr(ctx context.Context, commandID, corrID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE tracker_commands
		SET status = 'sent',
		    sent_at = COALESCE(sent_at, now()),
		    corr_id = CASE WHEN $2 <> '' THEN $2 ELSE corr_id END
		WHERE id = $1::uuid AND status = 'pending'`, commandID, corrID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		metrics.CommandSent()
		return nil
	}
	// Already claimed: only attach corr_id.
	_, err = s.pool.Exec(ctx, `
		UPDATE tracker_commands
		SET corr_id = CASE WHEN $2 <> '' THEN $2 ELSE corr_id END
		WHERE id = $1::uuid AND status = 'sent'`, commandID, corrID)
	return err
}

// RequeueCommand returns a claimed (sent, no terminal ack) command to pending.
func (s *Store) RequeueCommand(ctx context.Context, commandID string) error {
	return s.requeueCommand(ctx, commandID, false)
}

// RequeueCommandRotate requeues and bumps created_at so other pending commands
// are not starved behind an offline / not-ready device.
func (s *Store) RequeueCommandRotate(ctx context.Context, commandID string) error {
	return s.requeueCommand(ctx, commandID, true)
}

func (s *Store) requeueCommand(ctx context.Context, commandID string, rotate bool) error {
	q := `
		UPDATE tracker_commands
		SET status = 'pending', sent_at = NULL, corr_id = ''
		WHERE id = $1::uuid AND status = 'sent' AND completed_at IS NULL`
	if rotate {
		q = `
		UPDATE tracker_commands
		SET status = 'pending', sent_at = NULL, corr_id = '', created_at = now()
		WHERE id = $1::uuid AND status = 'sent' AND completed_at IS NULL`
	}
	_, err := s.pool.Exec(ctx, q, commandID)
	return err
}

func (s *Store) MarkCommandFailed(ctx context.Context, commandID string, reason string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE tracker_commands
		SET status = 'failed', response_text = $2, completed_at = now()
		WHERE id = $1::uuid AND status IN ('pending', 'sent')`, commandID, reason)
	if err == nil && tag.RowsAffected() > 0 {
		metrics.CommandFailed()
	}
	return err
}

func (s *Store) EnqueueCommandResult(ctx context.Context, commandID string, ok bool, response string) error {
	status := "acked"
	if !ok {
		status = "failed"
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE tracker_commands
		SET status = $2, response_text = $3, completed_at = now()
		WHERE id = $1::uuid`, commandID, status, response)
	return err
}

// ExpireStaleCommands marks old pending/sent commands as expired.
// pendingMaxAge: never sent; sentMaxAge: sent but no ack.
func (s *Store) ExpireStaleCommands(ctx context.Context, pendingMaxAge, sentMaxAge time.Duration) (int64, error) {
	if pendingMaxAge < time.Minute {
		pendingMaxAge = 24 * time.Hour
	}
	if sentMaxAge < time.Minute {
		sentMaxAge = 30 * time.Minute
	}
	pendingSec := int64(pendingMaxAge.Seconds())
	sentSec := int64(sentMaxAge.Seconds())
	tag, err := s.pool.Exec(ctx, `
		UPDATE tracker_commands
		SET status = 'expired',
		    response_text = CASE
		      WHEN response_text = '' THEN 'expired: no ack in time'
		      ELSE response_text
		    END,
		    completed_at = now()
		WHERE (status = 'pending' AND created_at < now() - make_interval(secs => $1::int))
		   OR (status = 'sent' AND COALESCE(sent_at, created_at) < now() - make_interval(secs => $2::int))`,
		pendingSec, sentSec)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// AckLatestSent marks the most recent sent (or pending) command for a device as acked/failed.
func (s *Store) AckLatestSent(ctx context.Context, deviceID string, ok bool, response string) error {
	return s.AckCommand(ctx, deviceID, "", ok, response)
}

// AckCommand prefers matching corr_id on a sent command; falls back to latest sent/pending.
func (s *Store) AckCommand(ctx context.Context, deviceID, corrID string, ok bool, response string) error {
	status := "acked"
	if !ok {
		status = "failed"
	}
	note := func(n int64) {
		if n <= 0 {
			return
		}
		if ok {
			metrics.CommandAcked()
		} else {
			metrics.CommandFailed()
		}
	}
	if corrID != "" {
		tag, err := s.pool.Exec(ctx, `
			UPDATE tracker_commands
			SET status = $3, response_text = $4, completed_at = now()
			WHERE id = (
				SELECT id FROM tracker_commands
				WHERE device_id = $1::uuid AND status = 'sent' AND corr_id = $2
				ORDER BY COALESCE(sent_at, created_at) DESC
				LIMIT 1
			)`, deviceID, corrID, status, response)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			note(tag.RowsAffected())
			return nil
		}
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE tracker_commands
		SET status = $2, response_text = $3, completed_at = now()
		WHERE id = (
			SELECT id FROM tracker_commands
			WHERE device_id = $1::uuid AND status IN ('sent', 'pending')
			ORDER BY COALESCE(sent_at, created_at) DESC
			LIMIT 1
		)`, deviceID, status, response)
	if err == nil {
		note(tag.RowsAffected())
	}
	return err
}

// CountCommandsByStatus returns pending/sent/acked/failed/expired counts (gateway health).
func (s *Store) CountCommandsByStatus(ctx context.Context) (map[string]int64, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT status, count(*)::bigint FROM tracker_commands
		WHERE status IN ('pending', 'sent', 'acked', 'failed', 'expired')
		  AND created_at > now() - interval '7 days'
		GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var st string
		var n int64
		if err := rows.Scan(&st, &n); err != nil {
			continue
		}
		out[st] = n
	}
	return out, rows.Err()
}

func (s *Store) InsertSafetyEvent(ctx context.Context, device *Device, ev SafetyEvent) error {
	if device == nil {
		return nil
	}
	if ev.RecordedAt.IsZero() {
		ev.RecordedAt = time.Now().UTC()
	}
	if ev.RawAttrs == nil {
		ev.RawAttrs = map[string]any{}
	}
	// Promote Su Biao type keys into remappable vendor keys for Device Manager.
	if st, ok := ev.RawAttrs["subiao_type"].(string); ok && st != "" {
		switch st {
		case "0x64":
			ev.RawAttrs["adas.fcw"] = true
		case "0x65":
			ev.RawAttrs["dsm.fatigue"] = true
		case "0x67":
			ev.RawAttrs["bsd_blind"] = true
			ev.RawAttrs["bsd.blind"] = true
		}
	}
	if rules, err := s.LoadRemapRules(ctx, device.ID, device.ProfileID); err == nil && len(rules) > 0 {
		ev.MappedAttrs = ApplyRemap(ev.RawAttrs, rules)
	}
	if ev.MappedAttrs == nil {
		ev.MappedAttrs = map[string]any{}
	}
	if ev.SourceProtocol == "" {
		ev.SourceProtocol = device.Protocol
	}
	// Dedupe bursty uplinks: same device + alarm_type within 30s.
	var recent int
	_ = s.pool.QueryRow(ctx, `
		SELECT 1 FROM tracker_safety_events
		WHERE device_id = $1::uuid AND alarm_type = $2
		  AND recorded_at > $3::timestamptz - interval '30 seconds'
		LIMIT 1`,
		device.ID, ev.AlarmType, ev.RecordedAt,
	).Scan(&recent)
	if recent == 1 {
		return nil
	}
	raw, _ := json.Marshal(ev.RawAttrs)
	mapped, _ := json.Marshal(ev.MappedAttrs)
	_, err := s.pool.Exec(ctx, `
		INSERT INTO tracker_safety_events (
			tenant_id, device_id, recorded_at, alarm_type, alarm_level,
			lat, lon, attachment_id, source_protocol, raw_attrs, mapped_attrs
		) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
		device.TenantID, device.ID, ev.RecordedAt, ev.AlarmType, ev.AlarmLevel,
		ev.Lat, ev.Lon, ev.AttachmentID, ev.SourceProtocol, string(raw), string(mapped),
	)
	return err
}
