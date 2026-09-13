-- Mid-day recovery foundations: durable planned ETA, ops exceptions, replan audit.

ALTER TABLE dispatch_stops
  ADD COLUMN IF NOT EXISTS planned_eta TEXT;

COMMENT ON COLUMN dispatch_stops.planned_eta IS
  'Planned arrival clock HH:MM (Asia/Jakarta service day) snapshotted at plan/optimize.';

CREATE TABLE IF NOT EXISTS dispatch_ops_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('window_at_risk', 'stuck', 'failed_skip')),
  job_id UUID REFERENCES dispatch_jobs (id) ON DELETE SET NULL,
  stop_id UUID REFERENCES dispatch_stops (id) ON DELETE SET NULL,
  order_id UUID REFERENCES dispatch_orders (id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'warn'
    CHECK (severity IN ('info', 'warn', 'critical')),
  title TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  acked_at TIMESTAMPTZ,
  acked_note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_ops_exceptions_open_fp_uidx
  ON dispatch_ops_exceptions (tenant_id, fingerprint)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS dispatch_ops_exceptions_tenant_date_idx
  ON dispatch_ops_exceptions (tenant_id, service_date, created_at DESC);

CREATE INDEX IF NOT EXISTS dispatch_ops_exceptions_open_idx
  ON dispatch_ops_exceptions (tenant_id, service_date)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS dispatch_replan_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  service_date DATE NOT NULL,
  actor TEXT NOT NULL DEFAULT 'user'
    CHECK (actor IN ('user', 'auto_safe')),
  action TEXT NOT NULL,
  job_id UUID REFERENCES dispatch_jobs (id) ON DELETE SET NULL,
  stop_id UUID REFERENCES dispatch_stops (id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_replan_audit_tenant_date_idx
  ON dispatch_replan_audit (tenant_id, service_date, created_at DESC);
