-- Default Concox / JT808 alarm vendor keys → app params on system profiles.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('concox', 'alarm.sos', 'SOS', 'bool', 'Concox SOS'),
  ('concox', 'alarm.power_cut', 'Power cut', 'bool', 'Concox power cut'),
  ('concox', 'alarm.overspeed', 'Overspeed', 'bool', 'Concox overspeed'),
  ('concox', 'alarm.vibration', 'Vibration', 'bool', 'Concox vibration'),
  ('concox', 'alarm.crash', 'Crash', 'bool', 'Concox crash'),
  ('jt808', 'alarm.sos', 'SOS', 'bool', 'JT808 alarm bit0'),
  ('jt808', 'alarm.overspeed', 'Overspeed', 'bool', 'JT808 alarm bit1'),
  ('jt808', 'status.acc', 'ACC', 'bool', 'JT808 status bit0 ignition'),
  ('ruptela', 'event_io', 'Event IO', 'number', 'Ruptela record event IO id'),
  ('ruptela', 'alarm.overspeed', 'Overspeed', 'bool', 'Ruptela event 255'),
  ('ruptela', 'alarm.towing', 'Towing', 'bool', 'Ruptela event 246')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('overspeed', 'avl', 'bool', '', 'Overspeed', 'Speed over threshold')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('alarm.sos', 'sos'),
  ('alarm.overspeed', 'overspeed'),
  ('status.acc', 'ignition')
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
  ('alarm.sos', 'sos'),
  ('alarm.overspeed', 'overspeed')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'jt808'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
