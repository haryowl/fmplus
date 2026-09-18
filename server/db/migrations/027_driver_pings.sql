-- Driver phone location stream from the mobile Dispatch PWA.
-- Keyed on field_user_id, not armada_user_id: the driver app is independent of
-- whether a vehicle tracker exists in Armada.

CREATE TABLE IF NOT EXISTS driver_pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  field_user_id UUID NOT NULL REFERENCES field_users (id) ON DELETE CASCADE,
  job_id UUID REFERENCES dispatch_jobs (id) ON DELETE SET NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  speed_mps DOUBLE PRECISION,
  heading_deg DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'phone'
    CHECK (source IN ('phone')),
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-fix lookup per driver (Dispatch Live reads this on every poll).
CREATE INDEX IF NOT EXISTS driver_pings_user_recent_idx
  ON driver_pings (tenant_id, field_user_id, recorded_at DESC);

-- Retention prune scan.
CREATE INDEX IF NOT EXISTS driver_pings_recorded_idx
  ON driver_pings (recorded_at);

-- A replayed offline queue must not duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS driver_pings_user_time_uidx
  ON driver_pings (field_user_id, recorded_at);
