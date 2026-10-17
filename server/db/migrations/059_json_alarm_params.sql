-- JSON HTTP ingest: alarm.* / event_io vendor keys + default profile maps (parity with TCP).
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('json', 'alarm.sos', 'SOS', 'bool', 'JSON alarm.sos'),
  ('json', 'alarm.crash', 'Crash', 'bool', 'JSON alarm.crash'),
  ('json', 'alarm.collision', 'Collision', 'bool', 'JSON alarm.collision'),
  ('json', 'alarm.power_cut', 'Power cut', 'bool', 'JSON alarm.power_cut'),
  ('json', 'alarm.overspeed', 'Overspeed', 'bool', 'JSON alarm.overspeed'),
  ('json', 'alarm.towing', 'Towing', 'bool', 'JSON alarm.towing'),
  ('json', 'alarm.jamming', 'Jamming', 'bool', 'JSON alarm.jamming'),
  ('json', 'alarm.vibration', 'Vibration', 'bool', 'JSON alarm.vibration'),
  ('json', 'alarm.fence_in', 'Geofence in', 'bool', 'JSON alarm.fence_in'),
  ('json', 'alarm.fence_out', 'Geofence out', 'bool', 'JSON alarm.fence_out'),
  ('json', 'event_io', 'Event IO', 'number', 'Teltonika-style event id on JSON body'),
  ('json', 'io.239', 'Ignition IO', 'number', 'Nested io.239 after flatten'),
  ('json', 'ext_voltage', 'External voltage', 'number', 'Concox-style voltage via JSON'),
  ('concox', 'ext_voltage', 'External voltage', 'number', '0x94 info type 0x00'),
  ('concox', 'iccid', 'ICCID', 'string', '0x94 info type 0x0A'),
  ('concox', 'mcc', 'MCC', 'number', 'LBS / GPS tail'),
  ('concox', 'cell_id', 'Cell ID', 'number', '0x18 LBS'),
  ('galileosky', 'tag.0x40', 'Status 0x40', 'number', 'Device status byte (bit0 SOS on many firmwares)'),
  ('galileosky', 'tag.0x41', 'Status 0x41', 'number', 'Status variant'),
  ('galileosky', 'tag.0x42', 'Status 0x42', 'number', 'Status variant'),
  ('galileosky', 'alarm.sos', 'SOS', 'bool', 'From tag 0x40 bit0')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('alarm.sos', 'sos'),
  ('alarm.crash', 'crash'),
  ('alarm.overspeed', 'overspeed'),
  ('alarm.towing', 'tow'),
  ('alarm.jamming', 'jamming'),
  ('status.acc', 'ignition')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'json'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, 'alarm.sos', 'sos', 'identity', '{}'::jsonb
FROM tracker_device_profiles p
WHERE p.tenant_id IS NULL AND p.protocol = 'galileosky'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = 'alarm.sos'
  );
