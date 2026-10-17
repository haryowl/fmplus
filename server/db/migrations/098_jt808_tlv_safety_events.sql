-- Document that location TLV alarms (fence/route/manual) raise safety events.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'alarm.fence_out', 'Geofence out', 'bool', 'TLV 0x12 direction≠0 → safety'),
  ('jt808', 'alarm.route_time_short', 'Route time short', 'bool', 'TLV 0x13 → safety'),
  ('subiao', 'alarm.fence_out', 'Geofence out', 'bool', 'Inherited JT808 TLV'),
  ('subiao', 'alarm.sos', 'SOS', 'bool', 'TLV 0x04 / alarm dword')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
