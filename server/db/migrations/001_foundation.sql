-- FM Plus tenant vault + entitlements foundation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  app_id INTEGER NOT NULL CHECK (app_id > 0),
  -- AES-GCM ciphertext (base64) of Armada Authorization token
  token_ciphertext TEXT NOT NULL,
  webhook_secret_hash TEXT,
  user_ids INTEGER[] NOT NULL DEFAULT '{}',
  group_ids INTEGER[] NOT NULL DEFAULT '{}',
  -- module visibility, feature flags, allow/deny actions (Admin control plane)
  entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_app_id_idx ON tenants (app_id);
CREATE INDEX IF NOT EXISTS tenants_enabled_idx ON tenants (enabled) WHERE enabled = true;

-- Placeholder for field users (Maintenance / Dispatch PWA); filled in Field-auth phase
CREATE TABLE IF NOT EXISTS field_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'operator',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username)
);

CREATE INDEX IF NOT EXISTS field_users_tenant_idx ON field_users (tenant_id);
