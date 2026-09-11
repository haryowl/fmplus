-- Per-vehicle volume/weight capacity presets (Armada user id within tenant)

CREATE TABLE IF NOT EXISTS vehicle_capacities (
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  armada_user_id INTEGER NOT NULL CHECK (armada_user_id > 0),
  volume_capacity_m3 DOUBLE PRECISION NOT NULL DEFAULT 12
    CHECK (volume_capacity_m3 > 0),
  weight_capacity_kg DOUBLE PRECISION NOT NULL DEFAULT 1500
    CHECK (weight_capacity_kg > 0),
  label TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, armada_user_id)
);

CREATE INDEX IF NOT EXISTS vehicle_capacities_tenant_idx
  ON vehicle_capacities (tenant_id);
