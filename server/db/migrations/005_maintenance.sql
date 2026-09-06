-- Maintenance D0–D1: service events (due board)
CREATE TABLE IF NOT EXISTS service_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'due'
    CHECK (status IN ('due', 'in_progress', 'done', 'skipped')),
  title TEXT NOT NULL,
  notes TEXT,
  armada_user_id INTEGER,
  armada_username TEXT,
  user_display_name TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  notification_id UUID UNIQUE REFERENCES armada_notifications (id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  odometer_km DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_events_tenant_status_created_idx
  ON service_events (tenant_id, status, created_at DESC);
