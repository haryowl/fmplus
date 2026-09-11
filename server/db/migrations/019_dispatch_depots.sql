-- Named depots for multi-depot CVRP; optional vehicle→depot binding

CREATE TABLE IF NOT EXISTS dispatch_depots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Depot',
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_depots_lat_chk CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT dispatch_depots_lon_chk CHECK (lon BETWEEN -180 AND 180)
);

CREATE INDEX IF NOT EXISTS dispatch_depots_tenant_idx
  ON dispatch_depots (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_depots_one_default_idx
  ON dispatch_depots (tenant_id)
  WHERE is_default;

ALTER TABLE vehicle_capacities
  ADD COLUMN IF NOT EXISTS depot_id UUID REFERENCES dispatch_depots (id) ON DELETE SET NULL;

-- Seed from legacy tenant single-depot columns when present and no rows yet
INSERT INTO dispatch_depots (tenant_id, name, lat, lon, is_default)
SELECT t.id, 'Default', t.dispatch_depot_lat, t.dispatch_depot_lon, true
FROM tenants t
WHERE t.dispatch_depot_lat IS NOT NULL
  AND t.dispatch_depot_lon IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dispatch_depots d WHERE d.tenant_id = t.id
  );
