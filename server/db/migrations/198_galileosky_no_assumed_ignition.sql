-- Galileosky has no canonical ignition tag. Stop assuming 0x46 / 0x40 / 0x41.
-- Users map din0, tag.0x46, or status.engine → ignition in Device Mapper.

DELETE FROM tracker_param_maps m
USING tracker_device_profiles p
WHERE m.profile_id = p.id
  AND p.tenant_id IS NULL
  AND p.protocol = 'galileosky'
  AND m.app_param_id = 'ignition';

DELETE FROM tracker_protocol_params
WHERE protocol = 'galileosky'
  AND vendor_key IN ('ignition', 'status.ignition', 'status.acc');

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'status.din0', 'Digital in 0', 'bool', 'Tag 0x46 bit0. Map to ignition in Device Mapper if this input is ACC'),
  ('galileosky', 'status.engine', 'Engine flag', 'bool', 'Tag 0x40 bit9 (device status). Map to ignition in Device Mapper if used as ACC'),
  ('galileosky', 'tag.0x46', 'Input status', 'number', 'Discrete input bitmask (official tag 0x46)')
ON CONFLICT (protocol, vendor_key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    value_type = EXCLUDED.value_type;

UPDATE tracker_protocol_params
SET description = 'Official tag 0x01 — hardware version'
WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x01';
