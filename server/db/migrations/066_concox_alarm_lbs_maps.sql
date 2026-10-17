-- Concox profile maps for power_cut / vibration / crash + LBS keys (cell_id → gsm).
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('power_cut', 'avl', 'bool', '', 'Power cut', 'External power disconnected'),
  ('vibration', 'avl', 'bool', '', 'Vibration', 'Vibration / shock alarm'),
  ('cell_id', 'avl', 'number', '', 'Cell ID', 'Serving cell identifier')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('concox', 'rssi', 'RSSI', 'number', '0x18 LBS signal'),
  ('concox', 'mcc', 'MCC', 'number', '0x18 LBS MCC'),
  ('concox', 'mnc', 'MNC', 'number', '0x18 LBS MNC'),
  ('concox', 'lac', 'LAC', 'number', '0x18 LBS LAC')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('alarm.power_cut', 'power_cut'),
  ('alarm.vibration', 'vibration'),
  ('alarm.crash', 'crash'),
  ('rssi', 'gsm_signal'),
  ('cell_id', 'cell_id')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'concox'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
