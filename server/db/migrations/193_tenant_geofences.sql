-- Native Places / Fleet Live geofences (circle first; polygon ring reserved).

CREATE TABLE IF NOT EXISTS tenant_geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'circle'
    CHECK (kind IN ('circle', 'polygon')),
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  radius_m DOUBLE PRECISION,
  ring JSONB NOT NULL DEFAULT '[]'::jsonb,
  color TEXT NOT NULL DEFAULT '#2563eb',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_geofences_shape_check CHECK (
    (kind = 'circle' AND lat IS NOT NULL AND lon IS NOT NULL AND radius_m > 0)
    OR (kind = 'polygon' AND jsonb_typeof(ring) = 'array' AND jsonb_array_length(ring) >= 3)
  )
);

CREATE INDEX IF NOT EXISTS tenant_geofences_tenant_idx
  ON tenant_geofences (tenant_id, enabled);

COMMENT ON TABLE tenant_geofences IS
  'ARMADA M.1 geofence catalog (independent of Armada). Circles for Places/Fleet Live; polygons later.';
