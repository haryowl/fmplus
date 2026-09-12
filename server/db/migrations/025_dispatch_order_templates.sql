-- Routine / repeatable order templates.
-- Instances are normal dispatch_orders rows with template_id set.

CREATE TABLE IF NOT EXISTS dispatch_order_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cadence TEXT NOT NULL DEFAULT 'daily'
    CHECK (cadence IN ('daily', 'weekdays', 'weekly')),
  -- For cadence = weekly: 0=Sun … 6=Sat (JS Date#getDay)
  weekday INT NULL CHECK (weekday IS NULL OR (weekday >= 0 AND weekday <= 6)),
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
  service_minutes INT NULL,
  proof_required BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_order_templates_tenant_idx
  ON dispatch_order_templates (tenant_id, enabled, updated_at DESC);

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS template_id UUID NULL REFERENCES dispatch_order_templates (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_orders_template_day_uidx
  ON dispatch_orders (tenant_id, template_id, service_date)
  WHERE template_id IS NOT NULL AND status <> 'cancelled';
