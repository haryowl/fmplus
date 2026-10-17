-- Finish 068 holes + Concox 0x94 mileage/fuel/sats + remove/fall alarms + driver extras.
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('remove', 'avl', 'bool', '', 'Remove', 'Device removed from mount'),
  ('fall', 'avl', 'bool', '', 'Fall', 'Fall detection'),
  ('steps', 'avl', 'number', '', 'Steps', 'Activity / step count'),
  ('driver_cert', 'avl', 'string', '', 'Driver cert', 'Driver qualification cert'),
  ('driver_state', 'avl', 'number', '', 'Driver state', 'JT808 0x0702 IC state')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('concox', 'odometer_km', 'Odometer km', 'number', '0x94 type 0x01'),
  ('concox', 'fuel_level', 'Fuel level', 'number', '0x94 type 0x02'),
  ('concox', 'satellites', 'Satellites', 'number', '0x94 type 0x0c'),
  ('concox', 'steps', 'Steps', 'number', '0x94 type 0x1a'),
  ('concox', 'alarm.remove', 'Remove', 'bool', 'GT06 0x13'),
  ('concox', 'alarm.fall', 'Fall', 'bool', 'GT06 0x23'),
  ('jt808', 'driver_cert', 'Driver cert', 'string', '0x0702'),
  ('jt808', 'driver_state', 'Driver state', 'number', '0x0702')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('wifi_ap_count', 'wifi_ap_count'),
  ('odometer_km', 'odometer_km'),
  ('fuel_level', 'fuel_level'),
  ('satellites', 'satellites'),
  ('steps', 'steps'),
  ('alarm.remove', 'remove'),
  ('alarm.fall', 'fall')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'concox'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('driver_cert', 'driver_cert'),
  ('driver_state', 'driver_state')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol IN ('jt808', 'subiao')
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
