-- Extra Teltonika AVL IDs (wiki Parameter / FMB data sending) + Concox alarm remap seeds.
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('crash', 'avl', 'bool', '', 'Crash', 'Crash / accident detection'),
  ('overspeed', 'avl', 'bool', '', 'Overspeed', 'Speed over threshold'),
  ('jamming', 'avl', 'bool', '', 'Jamming', 'GNSS/GSM jamming')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'io.240', 'Movement (AVL 240)', 'bool', 'Movement'),
  ('teltonika', 'io.246', 'Towing (AVL 246)', 'bool', 'Towing detection'),
  ('teltonika', 'io.247', 'Crash (AVL 247)', 'number', 'Crash detection code'),
  ('teltonika', 'io.249', 'Jamming (AVL 249)', 'bool', 'Jamming'),
  ('teltonika', 'io.251', 'Idling (AVL 251)', 'bool', 'Idling'),
  ('teltonika', 'io.252', 'Unplug (AVL 252)', 'bool', 'Unplug detection'),
  ('teltonika', 'io.255', 'Overspeed (AVL 255)', 'number', 'Overspeed km/h'),
  ('teltonika', 'alarm.towing', 'Towing alarm', 'bool', 'Event IO 246 flattened'),
  ('teltonika', 'alarm.crash', 'Crash alarm', 'bool', 'Event IO 247 flattened'),
  ('teltonika', 'alarm.jamming', 'Jamming alarm', 'bool', 'Event IO 249 flattened'),
  ('concox', 'alarm.fence_in', 'Geofence in', 'bool', 'GT06 alarm 0x04'),
  ('concox', 'alarm.fence_out', 'Geofence out', 'bool', 'GT06 alarm 0x05'),
  ('concox', 'alarm.crash', 'Crash', 'bool', 'GT06 alarm 0x29'),
  ('concox', 'alarm.vibration', 'Vibration', 'bool', 'GT06 alarm 0x03')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('alarm.towing', 'tow'),
  ('alarm.crash', 'crash'),
  ('alarm.jamming', 'jamming'),
  ('alarm.overspeed', 'overspeed')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'teltonika'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('alarm.sos', 'sos'),
  ('alarm.overspeed', 'overspeed'),
  ('alarm.crash', 'crash')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'concox'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
