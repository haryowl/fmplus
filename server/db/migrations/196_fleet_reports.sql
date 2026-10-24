-- Fleet Live Reports: saved Device Source builders + schedule metadata.

CREATE TABLE IF NOT EXISTS fleet_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'device'
    CHECK (source IN ('device')),
  spec JSONB NOT NULL DEFAULT '{}'::jsonb,
  recipients TEXT NOT NULL DEFAULT '',
  cc_tenant_notify BOOLEAN NOT NULL DEFAULT false,
  schedule_kind TEXT NOT NULL DEFAULT 'off'
    CHECK (schedule_kind IN ('off', 'daily', 'weekly')),
  schedule_hour INTEGER NOT NULL DEFAULT 7
    CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
  schedule_weekday INTEGER NOT NULL DEFAULT 1
    CHECK (schedule_weekday >= 0 AND schedule_weekday <= 6),
  last_run_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_reports_tenant_idx
  ON fleet_reports (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS fleet_report_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  report_id UUID REFERENCES fleet_reports (id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  row_count INTEGER NOT NULL DEFAULT 0,
  byte_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS fleet_report_runs_tenant_idx
  ON fleet_report_runs (tenant_id, started_at DESC);
