-- Phase F+ — Orders pool, capacity fields, stop POD photos

ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS volume_capacity_m3 DOUBLE PRECISION NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS weight_capacity_kg DOUBLE PRECISION NOT NULL DEFAULT 1500;

ALTER TABLE dispatch_stops
  ADD COLUMN IF NOT EXISTS order_id UUID,
  ADD COLUMN IF NOT EXISTS zone TEXT,
  ADD COLUMN IF NOT EXISTS volume_m3 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS weight_kg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS window_start TEXT,
  ADD COLUMN IF NOT EXISTS window_end TEXT;

CREATE TABLE IF NOT EXISTS dispatch_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  external_ref TEXT,
  customer_name TEXT NOT NULL DEFAULT '',
  address TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  zone TEXT,
  volume_m3 DOUBLE PRECISION,
  weight_kg DOUBLE PRECISION,
  window_start TEXT,
  window_end TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'assigned', 'cancelled')),
  job_id UUID REFERENCES dispatch_jobs (id) ON DELETE SET NULL,
  stop_id UUID REFERENCES dispatch_stops (id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_orders_tenant_status_idx
  ON dispatch_orders (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS dispatch_orders_job_idx
  ON dispatch_orders (job_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_stops_order_id_fkey'
  ) THEN
    ALTER TABLE dispatch_stops
      ADD CONSTRAINT dispatch_stops_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES dispatch_orders (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS dispatch_stop_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id UUID NOT NULL REFERENCES dispatch_stops (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  content_type TEXT,
  bytes INTEGER,
  caption TEXT,
  uploaded_by_field_user_id UUID REFERENCES field_users (id) ON DELETE SET NULL,
  payload BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_stop_photos_stop_idx
  ON dispatch_stop_photos (stop_id, created_at DESC);
