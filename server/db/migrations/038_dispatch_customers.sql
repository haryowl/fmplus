-- Saved customers for dispatch orders. Picking a customer copies these fields
-- onto the order; later edits do not rewrite orders already created.

CREATE TABLE IF NOT EXISTS dispatch_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  zone TEXT,
  address TEXT,
  phone TEXT,
  contact_name TEXT,
  notes TEXT,
  window_start TEXT,
  window_end TEXT,
  proof_required BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_customers_tenant_name_idx
  ON dispatch_customers (tenant_id, lower(name));

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS customer_id UUID NULL REFERENCES dispatch_customers (id) ON DELETE SET NULL;
