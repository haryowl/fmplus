-- Dispatch planning by calendar day (not "today-only")

ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS service_date DATE NOT NULL DEFAULT (CURRENT_DATE);

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS service_date DATE NOT NULL DEFAULT (CURRENT_DATE);

CREATE INDEX IF NOT EXISTS dispatch_jobs_tenant_service_date_idx
  ON dispatch_jobs (tenant_id, service_date, status);

CREATE INDEX IF NOT EXISTS dispatch_orders_tenant_service_date_idx
  ON dispatch_orders (tenant_id, service_date, status);
