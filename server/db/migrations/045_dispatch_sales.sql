-- Sales visit profile: visit outcomes on Finish, optional spawn delivery order.

ALTER TABLE dispatch_stops
  ADD COLUMN IF NOT EXISTS visit_outcome TEXT;

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS profile TEXT,
  ADD COLUMN IF NOT EXISTS visit_outcome TEXT,
  ADD COLUMN IF NOT EXISTS spawned_from_order_id UUID REFERENCES dispatch_orders (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dispatch_orders_spawned_from_idx
  ON dispatch_orders (tenant_id, spawned_from_order_id)
  WHERE spawned_from_order_id IS NOT NULL;
