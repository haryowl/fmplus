-- Extra Su Biao remappable vendor keys used by gateway safety decode.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8500',
    'teltonika_codec12', 'concox_gprs', 'param', 'control', 'vehicle_control'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('subiao', 'bsd.blind', 'BSD blind', 'bool', 'Blind spot detection'),
  ('subiao', 'alarm_level', 'Alarm level', 'number', 'Active safety severity'),
  ('concox', 'status.acc', 'ACC', 'bool', 'Concox ACC / ignition'),
  ('galileosky', 'tag.0x01', 'DIN / flags', 'number', 'Digital inputs / flags'),
  ('galileosky', 'tag.0xd4', 'Odometer', 'number', 'Odometer (model-dependent)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('bsd.blind', 'bsd_blind'),
  ('alarm_level', 'alarm_level')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'subiao'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, 'status.acc', 'ignition', 'identity', '{}'::jsonb
FROM tracker_device_profiles p
WHERE p.tenant_id IS NULL AND p.protocol = 'concox'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = 'status.acc'
  );

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('ruptela', 'io.5', 'DIN / ignition', 'bool', 'Common Ruptela DIN1 / ignition'),
  ('ruptela', 'io.239', 'Ignition (alt)', 'bool', 'Alternate ignition IO on some FM configs'),
  ('ruptela', 'io.65', 'Odometer', 'number', 'Odometer (units model-dependent)'),
  ('ruptela', 'io.199', 'Odometer m', 'number', 'Odometer in meters on some firmwares'),
  ('galileosky', 'tag.0x30', 'Coordinates', 'object', 'Lat/lon/sats tag'),
  ('galileosky', 'tag.0x33', 'Speed/course', 'number', 'Speed and course tag')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, m.transform, m.arg::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('io.5', 'ignition', 'identity', '{}'),
  ('io.65', 'odometer_km', 'identity', '{}'),
  ('io.199', 'odometer_km', 'scale', '{"scale":0.001}')
) AS m(vendor_key, app_param_id, transform, arg)
WHERE p.tenant_id IS NULL AND p.protocol = 'ruptela'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, 'tag.0x01', 'ignition', 'bit_mask', '{"mask":1}'::jsonb
FROM tracker_device_profiles p
WHERE p.tenant_id IS NULL AND p.protocol = 'galileosky'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = 'tag.0x01'
  );
