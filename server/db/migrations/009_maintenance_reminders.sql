-- Maintenance Done→next + reminder notifications

ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS parent_event_id UUID REFERENCES service_events (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remind_before_days INTEGER,
  ADD COLUMN IF NOT EXISTS remind_before_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS remind_before_hours DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS service_events_parent_idx ON service_events (parent_event_id);

ALTER TABLE field_users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS notify_emails TEXT,
  ADD COLUMN IF NOT EXISTS notify_whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS wablas_base_url TEXT,
  ADD COLUMN IF NOT EXISTS wablas_token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS wablas_secret_ciphertext TEXT;

CREATE TABLE IF NOT EXISTS maintenance_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  event_id UUID REFERENCES service_events (id) ON DELETE SET NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('due_soon', 'overdue', 'next_due', 'assigned')),
  channel TEXT NOT NULL
    CHECK (channel IN ('platform', 'whatsapp', 'email')),
  recipient TEXT,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  acked_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error TEXT,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS maintenance_reminders_tenant_acked_idx
  ON maintenance_reminders (tenant_id, acked_at, created_at DESC);

CREATE INDEX IF NOT EXISTS maintenance_reminders_event_idx
  ON maintenance_reminders (event_id);
