-- JT809 0x1400 warn-body fields + 0x1210 attach filename.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt809', 'warn_time', 'Warn time', 'string', '0x1400 BCD time'),
  ('jt809', 'warn_time_bcd', 'Warn time BCD', 'string', '0x1400'),
  ('jt809', 'info_id', 'Alarm info id', 'number', '0x1400'),
  ('jt809', 'info_len', 'Alarm info length', 'number', '0x1400'),
  ('jt809', 'info_content', 'Alarm info text', 'string', '0x1400'),
  ('jt809', 'info_content_hex', 'Alarm info hex', 'string', '0x1400'),
  ('jt809', 'attach_file', 'Attach filename', 'string', '0x1210'),
  ('jt809', 'attach_hex', 'Attach hex', 'string', '0x1210')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
