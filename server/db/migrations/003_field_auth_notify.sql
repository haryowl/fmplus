-- Field-user auth sessions + Armada notifier ingest (B0)

ALTER TABLE field_users
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Drop incomplete placeholder rows (password never set)
DELETE FROM field_users WHERE password_hash IS NULL OR password_hash = '';

ALTER TABLE field_users
  ALTER COLUMN password_hash SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'field_users_role_check'
  ) THEN
    ALTER TABLE field_users
      ADD CONSTRAINT field_users_role_check
      CHECK (role IN ('operator', 'driver', 'dispatcher'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS field_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_user_id UUID NOT NULL REFERENCES field_users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS field_sessions_user_idx ON field_sessions (field_user_id);
CREATE INDEX IF NOT EXISTS field_sessions_expires_idx ON field_sessions (expires_at);

CREATE TABLE IF NOT EXISTS armada_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('exception', 'maintenance')),
  rule_name TEXT,
  event_time TIMESTAMPTZ,
  armada_username TEXT,
  user_display_name TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS armada_notifications_tenant_kind_created_idx
  ON armada_notifications (tenant_id, kind, created_at DESC);
