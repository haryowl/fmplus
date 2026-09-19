-- Optional zone → depot preferences for multi-depot Auto-plan.
-- Empty table / unused flags = identical to nearest-depot behaviour.

CREATE TABLE IF NOT EXISTS dispatch_zone_depot_map (
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  zone_key TEXT NOT NULL,
  zone_label TEXT NOT NULL DEFAULT '',
  depot_id UUID NOT NULL REFERENCES dispatch_depots (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, zone_key),
  CONSTRAINT dispatch_zone_depot_map_key_chk CHECK (char_length(zone_key) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS dispatch_zone_depot_map_depot_idx
  ON dispatch_zone_depot_map (depot_id);
