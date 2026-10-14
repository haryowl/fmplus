-- Catalog sell/cost (IDR per unit) and order-line snapshots.
-- Line unit_price is always taken from catalog at save (no client override).

ALTER TABLE dispatch_goods_items
  ADD COLUMN IF NOT EXISTS sell_price DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cost_price DOUBLE PRECISION;

ALTER TABLE dispatch_order_lines
  ADD COLUMN IF NOT EXISTS unit_price DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cost_price DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS line_amount DOUBLE PRECISION;

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS goods_subtotal DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS goods_cost_subtotal DOUBLE PRECISION;
