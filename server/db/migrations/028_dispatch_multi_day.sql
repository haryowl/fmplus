-- Multi-day dispatch tours.
--
-- A job's calendar span is service_date .. end_date, and each stop names the day
-- it belongs to via day_index (0 = service_date). Both columns default to the
-- single-day meaning, so every existing job keeps its current behaviour without
-- a backfill.

ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE dispatch_stops
  ADD COLUMN IF NOT EXISTS day_index INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN dispatch_jobs.end_date IS
  'Last calendar day of the tour. NULL means single-day (service_date only).';

COMMENT ON COLUMN dispatch_stops.day_index IS
  'Day offset within the tour; the stop''s calendar date is job.service_date + day_index.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_stops_day_index_range'
  ) THEN
    ALTER TABLE dispatch_stops
      ADD CONSTRAINT dispatch_stops_day_index_range
      CHECK (day_index >= 0 AND day_index <= 30);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatch_jobs_end_date_order'
  ) THEN
    ALTER TABLE dispatch_jobs
      ADD CONSTRAINT dispatch_jobs_end_date_order
      CHECK (end_date IS NULL OR end_date >= service_date);
  END IF;
END $$;

-- Span-overlap lookups ("which jobs touch this date").
CREATE INDEX IF NOT EXISTS dispatch_jobs_span_idx
  ON dispatch_jobs (tenant_id, service_date, end_date);

-- Per-day stop sequence reads.
CREATE INDEX IF NOT EXISTS dispatch_stops_job_day_idx
  ON dispatch_stops (job_id, day_index, sort_order);
