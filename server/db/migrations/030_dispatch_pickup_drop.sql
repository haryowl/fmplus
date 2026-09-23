-- Pickup + drop pairs on the same order (v1: one P and one D, same vehicle).
-- Existing rows stay kind=drop (delivery-only, implicit load at depot).

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'drop';

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_zone TEXT,
  ADD COLUMN IF NOT EXISTS pickup_window_start TEXT,
  ADD COLUMN IF NOT EXISTS pickup_window_end TEXT,
  ADD COLUMN IF NOT EXISTS pickup_service_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS pickup_proof_required BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_orders_kind_check'
  ) THEN
    ALTER TABLE dispatch_orders
      ADD CONSTRAINT dispatch_orders_kind_check
      CHECK (kind IN ('drop', 'pickup_drop'));
  END IF;
END $$;

ALTER TABLE dispatch_stops
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'drop';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_stops_role_check'
  ) THEN
    ALTER TABLE dispatch_stops
      ADD CONSTRAINT dispatch_stops_role_check
      CHECK (role IN ('pickup', 'drop'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS dispatch_stops_order_role_idx
  ON dispatch_stops (order_id, role);
