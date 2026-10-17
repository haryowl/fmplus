-- Finish 067 holes: upgrade/media channel, Concox wifi/LBS/iccid, common JT808 params.
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('media_channel', 'avl', 'number', '', 'Media channel', 'JT808 0x0801 channel'),
  ('media_event', 'avl', 'number', '', 'Media event', 'JT808 0x0801 event'),
  ('upgrade_result', 'avl', 'number', '', 'Upgrade result', 'JT808 0x0108 result'),
  ('wifi_ap_count', 'avl', 'number', '', 'WiFi AP count', 'Concox 0x23'),
  ('imsi', 'avl', 'string', '', 'IMSI', 'SIM IMSI')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'media_event', 'Media event', 'number', '0x0801'),
  ('jt808', 'param.0x0013', 'Heartbeat interval', 'number', '0x0104 common'),
  ('jt808', 'param.0x0029', 'Corner point', 'number', '0x0104 common'),
  ('concox', 'wifi.1.mac', 'WiFi AP1 MAC', 'string', '0x23'),
  ('concox', 'wifi.1.rssi', 'WiFi AP1 RSSI', 'number', '0x23'),
  ('concox', 'imsi', 'IMSI', 'string', '0x94 type 0x0e'),
  ('concox', 'iccid', 'ICCID', 'string', '0x94 type 0x0a')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('upgrade_result', 'upgrade_result'),
  ('media_channel', 'media_channel'),
  ('media_event', 'media_event')
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
  ('wifi_ap_count', 'wifi_ap_count'),
  ('iccid', 'iccid'),
  ('imsi', 'imsi')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'concox'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
