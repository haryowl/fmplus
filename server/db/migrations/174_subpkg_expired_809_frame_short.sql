-- JT808 subpackage GC honesty; JT809 short-frame honesty; session phone catalog.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'subpkg_expired', 'Subpackage expired', 'bool', 'Incomplete uplink assembly GC dropped'),
  ('jt808', 'subpkg_expired_n', 'Subpackages expired', 'number', 'Count dropped in one GC pass'),
  ('subiao', 'subpkg_expired', 'Subpackage expired', 'bool', 'Inherited JT808'),
  ('subiao', 'subpkg_expired_n', 'Subpackages expired', 'number', 'Inherited JT808'),
  ('jt809', 'frame_short', 'Frame too short', 'bool', 'Payload under 22-byte header'),
  ('jt809', 'frame_len', 'Frame length', 'number', 'Short payload byte length'),
  ('jt808', 'phone', 'Terminal phone', 'string', 'Session BCD phone / IMEI hint'),
  ('subiao', 'phone', 'Terminal phone', 'string', 'Inherited JT808 session meta')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
