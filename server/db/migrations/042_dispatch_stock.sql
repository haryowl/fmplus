-- Per-depot stock balances, truck/in-transit layer, and adjustment audit.
-- Auto pickup/delivery moves land in a follow-up slice; this migration is the ledger.

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS source_depot_id UUID REFERENCES dispatch_depots (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS dispatch_stock_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES dispatch_goods_items (id) ON DELETE CASCADE,
  depot_id UUID NOT NULL REFERENCES dispatch_depots (id) ON DELETE CASCADE,
  on_hand_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  reserved_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_stock_balances_unique UNIQUE (tenant_id, catalog_item_id, depot_id)
);

CREATE INDEX IF NOT EXISTS dispatch_stock_balances_item_idx
  ON dispatch_stock_balances (tenant_id, catalog_item_id);

CREATE INDEX IF NOT EXISTS dispatch_stock_balances_depot_idx
  ON dispatch_stock_balances (tenant_id, depot_id);

CREATE TABLE IF NOT EXISTS dispatch_truck_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES dispatch_jobs (id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES dispatch_goods_items (id) ON DELETE CASCADE,
  qty DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_truck_stock_unique UNIQUE (tenant_id, job_id, catalog_item_id)
);

CREATE INDEX IF NOT EXISTS dispatch_truck_stock_item_idx
  ON dispatch_truck_stock (tenant_id, catalog_item_id);

CREATE INDEX IF NOT EXISTS dispatch_truck_stock_job_idx
  ON dispatch_truck_stock (tenant_id, job_id);

CREATE TABLE IF NOT EXISTS dispatch_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  catalog_item_id UUID NOT NULL REFERENCES dispatch_goods_items (id) ON DELETE CASCADE,
  depot_id UUID REFERENCES dispatch_depots (id) ON DELETE SET NULL,
  job_id UUID REFERENCES dispatch_jobs (id) ON DELETE SET NULL,
  order_id UUID REFERENCES dispatch_orders (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  layer TEXT NOT NULL DEFAULT 'depot',
  qty_delta DOUBLE PRECISION NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_stock_movements_item_idx
  ON dispatch_stock_movements (tenant_id, catalog_item_id, created_at DESC);

-- Seed depot balances from legacy catalog on_hand into each tenant's default depot.
INSERT INTO dispatch_stock_balances (tenant_id, catalog_item_id, depot_id, on_hand_qty, reserved_qty)
SELECT g.tenant_id, g.id, d.id, g.on_hand_qty, COALESCE(g.reserved_qty, 0)
FROM dispatch_goods_items g
JOIN dispatch_depots d ON d.tenant_id = g.tenant_id AND d.is_default = true
WHERE g.on_hand_qty IS NOT NULL
ON CONFLICT (tenant_id, catalog_item_id, depot_id) DO NOTHING;
