-- Remember Auto-plan Day start so Optimize / Live ETA recompute do not fall back to 08:00.
ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS plan_day_start TEXT;

COMMENT ON COLUMN dispatch_jobs.plan_day_start IS
  'HH:MM shift start from Auto-plan (or Optimize). Used when recomputing planned_eta.';
