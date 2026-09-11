-- Per-stop dwell / service time (minutes at the location).
-- NULL on an order means “use Auto-plan Service min / stop default”.

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS service_minutes INT NULL;

ALTER TABLE dispatch_stops
  ADD COLUMN IF NOT EXISTS service_minutes INT NULL;
