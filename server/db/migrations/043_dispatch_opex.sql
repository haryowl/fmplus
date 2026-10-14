-- Operating cost rates (global + optional per depot) and job estimate/actual opex.

CREATE TABLE IF NOT EXISTS dispatch_cost_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  depot_id UUID REFERENCES dispatch_depots (id) ON DELETE CASCADE,
  rate_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  rate_stop DOUBLE PRECISION NOT NULL DEFAULT 0,
  rate_hour DOUBLE PRECISION NOT NULL DEFAULT 0,
  fixed_trip DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One global row (depot_id NULL) and at most one row per depot.
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_cost_rates_global_uidx
  ON dispatch_cost_rates (tenant_id)
  WHERE depot_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_cost_rates_depot_uidx
  ON dispatch_cost_rates (tenant_id, depot_id)
  WHERE depot_id IS NOT NULL;

ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS planned_distance_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS planned_duration_sec DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS actual_distance_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS actual_duration_sec DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS opex_estimate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS opex_actual DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS opex_depot_id UUID REFERENCES dispatch_depots (id) ON DELETE SET NULL;
