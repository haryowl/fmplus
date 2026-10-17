-- Door / secondary Concox alarms / JT808 0301 events / driver extras → default profile maps.
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('enter_area', 'avl', 'bool', '', 'Enter area', 'Geofence enter'),
  ('leave_area', 'avl', 'bool', '', 'Leave area', 'Geofence leave'),
  ('collision', 'avl', 'bool', '', 'Collision', 'Collision / impact'),
  ('rollover', 'avl', 'bool', '', 'Rollover', 'Vehicle rollover'),
  ('driver_change', 'avl', 'bool', '', 'Driver change', 'Driver identity change event'),
  ('power_on', 'avl', 'bool', '', 'Power on', 'Device powered on'),
  ('power_off', 'avl', 'bool', '', 'Power off', 'Device powered off'),
  ('gps_lost', 'avl', 'bool', '', 'GPS lost', 'GNSS fix lost'),
  ('gps_ok', 'avl', 'bool', '', 'GPS OK', 'GNSS fix restored')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'status.door', 'Door', 'bool', 'Location status door bit'),
  ('jt808', 'alarm.enter_area', 'Enter area', 'bool', '0x0301 id 5'),
  ('jt808', 'alarm.leave_area', 'Leave area', 'bool', '0x0301 id 6'),
  ('jt808', 'alarm.collision', 'Collision', 'bool', '0x0301 id 12'),
  ('jt808', 'alarm.rollover', 'Rollover', 'bool', '0x0301 id 13'),
  ('jt808', 'alarm.driver_change', 'Driver change', 'bool', '0x0301 id 14'),
  ('jt808', 'driver_ic_result', 'Driver IC result', 'number', '0x0702'),
  ('jt808', 'driver_time', 'Driver time', 'string', '0x0702 BCD'),
  ('concox', 'status.door', 'Door', 'bool', '0x94 type 0x05'),
  ('concox', 'door', 'Door raw', 'number', '0x94 type 0x05'),
  ('concox', 'alarm.enter_gps', 'Enter GPS', 'bool', 'GT06 0x0a'),
  ('concox', 'alarm.gps_lost', 'GPS lost', 'bool', 'GT06 0x0b'),
  ('concox', 'alarm.power_on', 'Power on', 'bool', 'GT06 0x0c'),
  ('concox', 'alarm.gps_ok', 'GPS OK', 'bool', 'GT06 0x0d'),
  ('concox', 'alarm.power_off', 'Power off', 'bool', 'GT06 0x0e')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('status.door', 'door_open'),
  ('alarm.enter_area', 'enter_area'),
  ('alarm.leave_area', 'leave_area'),
  ('alarm.collision', 'collision'),
  ('alarm.rollover', 'rollover'),
  ('alarm.driver_change', 'driver_change'),
  ('driver_ic_result', 'driver_state')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol IN ('jt808', 'subiao')
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('status.door', 'door_open'),
  ('alarm.gps_lost', 'gps_lost'),
  ('alarm.gps_ok', 'gps_ok'),
  ('alarm.power_on', 'power_on'),
  ('alarm.power_off', 'power_off'),
  ('alarm.enter_gps', 'gps_ok')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'concox'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
