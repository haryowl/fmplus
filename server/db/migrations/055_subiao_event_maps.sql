-- Finer Su Biao ADAS/DSM/BSD vendor keys + default profile remaps.
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('adas_pcw', 'safety', 'bool', '', 'ADAS PCW', 'Pedestrian collision warning'),
  ('adas_close', 'safety', 'bool', '', 'ADAS close', 'Too-close / headway warning'),
  ('dsm_distract', 'safety', 'bool', '', 'DSM distract', 'Driver distraction'),
  ('bsd_left', 'safety', 'bool', '', 'BSD left', 'Left rear blind spot'),
  ('bsd_right', 'safety', 'bool', '', 'BSD right', 'Right rear blind spot'),
  ('bsd_rear', 'safety', 'bool', '', 'BSD rear', 'Rear approach'),
  ('tpms_alarm', 'safety', 'bool', '', 'TPMS', 'Tire pressure alarm')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('subiao', 'adas.pcw', 'PCW', 'bool', 'Pedestrian collision'),
  ('subiao', 'adas.close', 'Close vehicle', 'bool', 'Headway / too close'),
  ('subiao', 'adas.obstacle', 'Obstacle', 'bool', 'ADAS obstacle'),
  ('subiao', 'dsm.smoke', 'Smoke', 'bool', 'DSM smoking'),
  ('subiao', 'dsm.distract', 'Distract', 'bool', 'DSM distraction'),
  ('subiao', 'bsd.left', 'BSD left', 'bool', 'Left rear BSD'),
  ('subiao', 'bsd.right', 'BSD right', 'bool', 'Right rear BSD'),
  ('subiao', 'bsd.rear', 'BSD rear', 'bool', 'Rear BSD'),
  ('subiao', 'tpms.alarm', 'TPMS', 'bool', 'Tire pressure'),
  ('jt808', 'adas.fcw', 'FCW', 'bool', 'JT808/Su Biao ADAS FCW on location'),
  ('jt808', 'dsm.fatigue', 'Fatigue', 'bool', 'JT808/Su Biao DSM fatigue on location'),
  ('teltonika', 'alarm.crash', 'Crash', 'bool', 'Event IO 247'),
  ('teltonika', 'alarm.towing', 'Towing', 'bool', 'Event IO 246'),
  ('teltonika', 'alarm.overspeed', 'Overspeed', 'bool', 'Event IO 255')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('adas.pcw', 'adas_pcw'),
  ('adas.close', 'adas_close'),
  ('dsm.smoke', 'dsm_smoke'),
  ('dsm.distract', 'dsm_distract'),
  ('bsd.left', 'bsd_left'),
  ('bsd.right', 'bsd_right'),
  ('bsd.rear', 'bsd_rear'),
  ('tpms.alarm', 'tpms_alarm')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol IN ('subiao', 'jt808')
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
