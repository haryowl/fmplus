-- Pickup-only orders: one collect stop (load at customer, no paired drop).

ALTER TABLE dispatch_orders DROP CONSTRAINT IF EXISTS dispatch_orders_kind_check;

ALTER TABLE dispatch_orders
  ADD CONSTRAINT dispatch_orders_kind_check
  CHECK (kind IN ('drop', 'pickup', 'pickup_drop'));
