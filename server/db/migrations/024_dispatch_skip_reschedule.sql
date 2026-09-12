-- Skip / Reschedule: keep skipped stop on job; reuse same order with new service_date.

ALTER TABLE dispatch_stops
  ADD COLUMN IF NOT EXISTS skip_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_to DATE NULL;
