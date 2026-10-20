-- Device-native vehicle capacity / depot / plate parity presets.
-- Rows may key by Armada user id and/or tracker device UUID.

ALTER TABLE vehicle_capacities
  ADD COLUMN IF NOT EXISTS id UUID;

UPDATE vehicle_capacities
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE vehicle_capacities
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE vehicle_capacities
  DROP CONSTRAINT IF EXISTS vehicle_capacities_pkey;

ALTER TABLE vehicle_capacities
  ADD PRIMARY KEY (id);

ALTER TABLE vehicle_capacities
  ADD COLUMN IF NOT EXISTS tracker_device_id UUID REFERENCES tracker_devices (id) ON DELETE CASCADE;

ALTER TABLE vehicle_capacities
  ALTER COLUMN armada_user_id DROP NOT NULL;

ALTER TABLE vehicle_capacities
  DROP CONSTRAINT IF EXISTS vehicle_capacities_armada_user_id_check;

ALTER TABLE vehicle_capacities
  ADD CONSTRAINT vehicle_capacities_armada_user_id_check
  CHECK (armada_user_id IS NULL OR armada_user_id > 0);

ALTER TABLE vehicle_capacities
  DROP CONSTRAINT IF EXISTS vehicle_capacities_vehicle_ref_check;

ALTER TABLE vehicle_capacities
  ADD CONSTRAINT vehicle_capacities_vehicle_ref_check
  CHECK (
    (armada_user_id IS NOT NULL AND armada_user_id > 0)
    OR tracker_device_id IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_capacities_tenant_armada_uidx
  ON vehicle_capacities (tenant_id, armada_user_id)
  WHERE armada_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_capacities_tenant_device_uidx
  ON vehicle_capacities (tenant_id, tracker_device_id)
  WHERE tracker_device_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vehicle_capacities_tenant_device_idx
  ON vehicle_capacities (tenant_id, tracker_device_id)
  WHERE tracker_device_id IS NOT NULL;

COMMENT ON COLUMN vehicle_capacities.tracker_device_id IS
  'Optional GPS device key for capacity/depot/plate presets when Armada is absent.';
