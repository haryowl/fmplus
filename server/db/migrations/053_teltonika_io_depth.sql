-- Extra Teltonika AVL IO keys + default profile remaps.

INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('overspeed', 'avl', 'bool', '', 'Overspeed', 'Speed over threshold'),
  ('idling', 'avl', 'bool', '', 'Idling', 'Engine idle')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'io.2', 'DIN2 (AVL 2)', 'bool', 'Digital input 2'),
  ('teltonika', 'io.3', 'DIN3 (AVL 3)', 'bool', 'Digital input 3'),
  ('teltonika', 'io.9', 'AIN1 (AVL 9)', 'number', 'Analog input 1'),
  ('teltonika', 'io.10', 'SD status (AVL 10)', 'number', 'SD status'),
  ('teltonika', 'io.11', 'ICCID1 (AVL 11)', 'number', 'SIM ICCID part'),
  ('teltonika', 'io.24', 'Speed (AVL 24)', 'number', 'GPS speed from IO'),
  ('teltonika', 'io.68', 'Battery current (AVL 68)', 'number', 'Battery current'),
  ('teltonika', 'io.69', 'GNSS status (AVL 69)', 'number', 'GNSS status'),
  ('teltonika', 'io.179', 'Digital output 1', 'bool', 'DOUT1'),
  ('teltonika', 'io.180', 'Digital output 2', 'bool', 'DOUT2'),
  ('teltonika', 'io.200', 'Sleep mode', 'number', 'Sleep mode'),
  ('teltonika', 'io.251', 'Idling', 'bool', 'Idling'),
  ('teltonika', 'io.253', 'Green driving type', 'number', 'Green driving'),
  ('teltonika', 'io.254', 'Green driving value', 'number', 'Green driving value'),
  ('teltonika', 'io.255', 'Overspeeding', 'bool', 'Overspeeding'),
  ('teltonika', 'io.389', 'Odometer (AVL 389)', 'number', 'Total odometer meters on some firmwares')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, m.transform, m.arg::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('io.1', 'ignition', 'identity', '{}'),
  ('io.255', 'overspeed', 'identity', '{}'),
  ('io.251', 'idling', 'identity', '{}'),
  ('io.389', 'odometer_km', 'scale', '{"scale":0.001}')
) AS m(vendor_key, app_param_id, transform, arg)
WHERE p.tenant_id IS NULL AND p.protocol = 'teltonika'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'alarm.sos', 'SOS', 'bool', 'JT808 alarm bit0'),
  ('jt808', 'alarm.overspeed', 'Overspeed', 'bool', 'JT808 alarm bit1'),
  ('jt808', 'alarm.fatigue', 'Fatigue', 'bool', 'JT808 alarm bit2'),
  ('jt808', 'alarm.power_cut', 'Power cut', 'bool', 'JT808 alarm bit8'),
  ('jt808', 'alarm.collision', 'Collision', 'bool', 'JT808 alarm bit20'),
  ('json', 'status.acc', 'ACC', 'bool', 'Nested status.acc from JSON ingest')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
