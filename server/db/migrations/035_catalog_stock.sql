-- Catalog on-hand (display only). Scan / complete does not decrement.
-- reserved_qty is stored for a later warehouse product.

ALTER TABLE dispatch_goods_items
  ADD COLUMN IF NOT EXISTS on_hand_qty DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reserved_qty DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE maintenance_catalog_items
  ADD COLUMN IF NOT EXISTS on_hand_qty DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS reserved_qty DOUBLE PRECISION NOT NULL DEFAULT 0;
