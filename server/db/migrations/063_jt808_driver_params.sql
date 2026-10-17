-- JT808 0x0702 driver identity vendor keys.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'driver_name', 'Driver name', 'string', '0x0702 IC card driver name'),
  ('jt808', 'driver_cert', 'Driver certificate', 'string', '0x0702 qualification / agency'),
  ('jt808', 'driver_state', 'Driver card state', 'number', '0x0702 insert/pull state'),
  ('subiao', 'driver_name', 'Driver name', 'string', '0x0702 driver name'),
  ('galileosky', 'tag.0xe1', 'Command reply', 'string', 'Length-prefixed text reply')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('driver_name', 'avl', 'string', '', 'Driver name', 'Driver identity from IC card / 0x0702')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, 'driver_name', 'driver_name', 'identity', '{}'::jsonb
FROM tracker_device_profiles p
WHERE p.tenant_id IS NULL AND p.protocol IN ('jt808', 'subiao')
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = 'driver_name'
  );
