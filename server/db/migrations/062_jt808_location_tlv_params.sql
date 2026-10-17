-- JT808 location additional TLVs decoded as remappable vendor keys (0x11/0x12/0x25/0x30/0x31).
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'alarm.fence_in', 'Geofence in', 'bool', 'TLV 0x12 direction=0'),
  ('jt808', 'alarm.fence_out', 'Geofence out', 'bool', 'TLV 0x12 direction≠0'),
  ('jt808', 'alarm.overspeed', 'Overspeed', 'bool', 'TLV 0x11 or alarm dword'),
  ('jt808', 'area_id', 'Area/line id', 'number', 'TLV 0x12 region id'),
  ('jt808', 'gsm_signal', 'GSM signal', 'number', 'TLV 0x30'),
  ('jt808', 'gnss_sats', 'GNSS satellites', 'number', 'TLV 0x31'),
  ('jt808', 'status.door', 'Door', 'bool', 'TLV 0x25 extended signal'),
  ('subiao', 'alarm.fence_in', 'Geofence in', 'bool', 'Inherited JT808 TLV 0x12'),
  ('subiao', 'alarm.fence_out', 'Geofence out', 'bool', 'Inherited JT808 TLV 0x12'),
  ('subiao', 'gsm_signal', 'GSM signal', 'number', 'TLV 0x30')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('geofence', 'avl', 'bool', '', 'Geofence', 'Enter/exit geofence or route area')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('alarm.fence_in', 'geofence'),
  ('alarm.fence_out', 'geofence'),
  ('alarm.overspeed', 'overspeed'),
  ('gsm_signal', 'gsm_signal'),
  ('status.acc', 'ignition')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol IN ('jt808', 'subiao')
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
