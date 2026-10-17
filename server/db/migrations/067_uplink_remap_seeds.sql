-- Seed uplink keys parsers already emit (JT808 media/attrs, Concox alarms/LBS, Ruptela extras).
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('wear', 'avl', 'bool', '', 'Wear', 'Device worn / removed inverse'),
  ('illegal_move', 'avl', 'bool', '', 'Illegal move', 'Movement while armed'),
  ('moving', 'avl', 'bool', '', 'Moving', 'In-motion alarm'),
  ('unplug', 'avl', 'bool', '', 'Unplug', 'Device unplugged'),
  ('media_type', 'avl', 'number', '', 'Media type', 'JT808 0x0801 media type'),
  ('media_id', 'avl', 'number', '', 'Media id', 'JT808 0x0801 media id'),
  ('waybill_text', 'avl', 'string', '', 'Waybill', 'Electronic waybill text'),
  ('iccid', 'avl', 'string', '', 'ICCID', 'SIM ICCID'),
  ('terminal_model', 'avl', 'string', '', 'Terminal model', 'JT808 0x0107 model'),
  ('transparent_type', 'avl', 'number', '', 'Transparent type', 'JT808 0x0900 type')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'media_type', 'Media type', 'number', '0x0801'),
  ('jt808', 'media_id', 'Media id', 'number', '0x0801'),
  ('jt808', 'media_channel', 'Media channel', 'number', '0x0801'),
  ('jt808', 'transparent_type', 'Transparent type', 'number', '0x0900'),
  ('jt808', 'waybill_text', 'Waybill text', 'string', '0x0701'),
  ('jt808', 'iccid', 'ICCID', 'string', '0x0107'),
  ('jt808', 'terminal_model', 'Terminal model', 'string', '0x0107'),
  ('jt808', 'upgrade_result', 'Upgrade result', 'number', '0x0108'),
  ('jt808', 'param.0x0001', 'Heartbeat interval', 'number', '0x0104 sample'),
  ('subiao', 'media_type', 'Media type', 'number', '0x0801'),
  ('concox', 'ext_voltage', 'External voltage', 'number', '0x94 type 0x00'),
  ('concox', 'alarm.wear', 'Wear', 'bool', 'GT06 0x14'),
  ('concox', 'alarm.illegal_move', 'Illegal move', 'bool', 'GT06 0x19'),
  ('concox', 'alarm.fence_in', 'Fence in', 'bool', 'GT06 0x04'),
  ('concox', 'alarm.fence_out', 'Fence out', 'bool', 'GT06 0x05'),
  ('concox', 'alarm.moving', 'Moving', 'bool', 'GT06 0x09'),
  ('concox', 'wifi_ap_count', 'WiFi AP count', 'number', '0x23')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('media_type', 'media_type'),
  ('media_id', 'media_id'),
  ('transparent_type', 'transparent_type'),
  ('waybill_text', 'waybill_text'),
  ('iccid', 'iccid'),
  ('terminal_model', 'terminal_model')
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
  ('ext_voltage', 'ext_voltage'),
  ('rssi', 'gsm_signal'),
  ('cell_id', 'cell_id'),
  ('alarm.wear', 'wear'),
  ('alarm.illegal_move', 'illegal_move'),
  ('alarm.fence_in', 'geofence'),
  ('alarm.fence_out', 'geofence'),
  ('alarm.moving', 'moving')
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
  ('alarm.idling', 'idling'),
  ('alarm.unplug', 'unplug'),
  ('alarm.green_driving', 'overspeed')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'ruptela'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
