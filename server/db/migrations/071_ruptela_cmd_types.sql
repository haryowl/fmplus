-- Ruptela config/command downlink types (105/107) alongside SMS 108.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8500',
    'teltonika_codec12', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107', 'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control', 'config'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'status.acc', 'Ignition', 'bool', 'From tag 0x41 bit0'),
  ('galileosky', 'alarm.vibration', 'Vibration', 'bool', 'From tag 0x40 bit1'),
  ('galileosky', 'alarm.overspeed', 'Overspeed', 'bool', 'From tag 0x42 bit0'),
  ('galileosky', 'alarm.towing', 'Towing', 'bool', 'From tag 0x43 bit0'),
  ('jt809', 'vehicle_plate', 'Vehicle plate', 'string', '0x1200 experimental'),
  ('jt1078', 'channel', 'AV channel', 'number', '1078 signaling')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('status.acc', 'ignition'),
  ('alarm.sos', 'sos'),
  ('alarm.overspeed', 'overspeed'),
  ('alarm.towing', 'tow')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'galileosky'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
