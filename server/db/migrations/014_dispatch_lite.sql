-- Phase F — Dispatch lite (jobs + ordered stops)

CREATE TABLE IF NOT EXISTS dispatch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'assigned', 'en_route', 'arrived', 'done', 'cancelled')),
  title TEXT NOT NULL DEFAULT '',
  notes TEXT,
  armada_user_id INTEGER,
  armada_username TEXT,
  user_display_name TEXT,
  assigned_field_user_id UUID REFERENCES field_users (id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  field_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_jobs_tenant_status_idx
  ON dispatch_jobs (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS dispatch_jobs_assignee_idx
  ON dispatch_jobs (tenant_id, assigned_field_user_id, status);

CREATE TABLE IF NOT EXISTS dispatch_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES dispatch_jobs (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  address TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'arrived', 'done', 'skipped')),
  arrived_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_stops_job_idx
  ON dispatch_stops (job_id, sort_order);
