-- Optional tenant goods catalog and per-order cargo lines.
-- Order volume/weight stay the Auto-plan totals; cargo_totals_locked means
-- Board overrode those totals so line edits do not rewrite them.

CREATE TABLE IF NOT EXISTS dispatch_goods_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  volume_m3_each DOUBLE PRECISION,
  weight_kg_each DOUBLE PRECISION,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_goods_items_tenant_idx
  ON dispatch_goods_items (tenant_id, enabled, sort_order, name);

CREATE TABLE IF NOT EXISTS dispatch_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES dispatch_orders (id) ON DELETE CASCADE,
  catalog_item_id UUID REFERENCES dispatch_goods_items (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'pcs',
  volume_m3_each DOUBLE PRECISION,
  weight_kg_each DOUBLE PRECISION,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_order_lines_order_idx
  ON dispatch_order_lines (order_id, sort_order);

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS cargo_totals_locked BOOLEAN NOT NULL DEFAULT false;
