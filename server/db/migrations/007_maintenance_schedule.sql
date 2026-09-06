-- Independent maintenance schedule / remind fields on service events
ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS remind_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remind_interval_days INTEGER,
  ADD COLUMN IF NOT EXISTS remind_interval_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS remind_baseline_odometer_km DOUBLE PRECISION;
