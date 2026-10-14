-- Passenger profile: seats/luggage capacity, passenger count, light fare rates.

ALTER TABLE vehicle_capacities
  ADD COLUMN IF NOT EXISTS seat_capacity INTEGER,
  ADD COLUMN IF NOT EXISTS luggage_capacity_kg DOUBLE PRECISION;

ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS seat_capacity INTEGER,
  ADD COLUMN IF NOT EXISTS luggage_capacity_kg DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fare_estimate DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS fare_actual DOUBLE PRECISION;

ALTER TABLE dispatch_orders
  ADD COLUMN IF NOT EXISTS passenger_count INTEGER,
  ADD COLUMN IF NOT EXISTS luggage_kg DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS dispatch_fare_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  depot_id UUID REFERENCES dispatch_depots (id) ON DELETE CASCADE,
  rate_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  fixed_booking DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_fare_rates_global_uidx
  ON dispatch_fare_rates (tenant_id)
  WHERE depot_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_fare_rates_depot_uidx
  ON dispatch_fare_rates (tenant_id, depot_id)
  WHERE depot_id IS NOT NULL;
