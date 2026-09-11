-- Tenant default depot for Dispatch CVRP (lat/lon WGS84)

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS dispatch_depot_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dispatch_depot_lon DOUBLE PRECISION;
