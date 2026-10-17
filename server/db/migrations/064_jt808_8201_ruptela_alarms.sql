-- JT808 location query downlink + Ruptela alarm.* vendor keys aligned with safety.go.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8107', 'jt808_8201', 'jt808_8500',
    'teltonika_codec12', 'concox_gprs', 'ruptela_sms', 'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('ruptela', 'alarm.crash', 'Crash', 'bool', 'Event IO 247'),
  ('ruptela', 'alarm.jamming', 'Jamming', 'bool', 'Event IO 249'),
  ('ruptela', 'alarm.idling', 'Idling', 'bool', 'Event IO 251'),
  ('ruptela', 'alarm.unplug', 'Unplug', 'bool', 'Event IO 252'),
  ('ruptela', 'alarm.geofence', 'Geofence', 'bool', 'Event IO 175'),
  ('ruptela', 'alarm.green_driving', 'Green driving', 'bool', 'Event IO 253'),
  ('ruptela', 'io.246', 'Towing IO', 'number', 'AVL-style towing'),
  ('ruptela', 'io.247', 'Crash IO', 'number', 'AVL-style crash')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('alarm.towing', 'tow'),
  ('alarm.crash', 'crash'),
  ('alarm.jamming', 'jamming'),
  ('alarm.overspeed', 'overspeed'),
  ('alarm.geofence', 'geofence')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'ruptela'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
