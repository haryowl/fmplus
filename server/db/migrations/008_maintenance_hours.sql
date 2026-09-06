-- Ignition-on hour intervals for independent maintenance schedules
ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS remind_interval_hours DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS remind_hours_since_at TIMESTAMPTZ;
