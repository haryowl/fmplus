-- JT808 GNSS constellation bits; Galileosky cmd.reply; Teltonika iButton; JT809 1500/160x.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'status.gnss_gps', 'GNSS GPS used', 'bool', 'Location status bit18'),
  ('jt808', 'status.gnss_beidou', 'GNSS Beidou used', 'bool', 'Location status bit19'),
  ('jt808', 'status.gnss_glonass', 'GNSS GLONASS used', 'bool', 'Location status bit20'),
  ('jt808', 'status.gnss_galileo', 'GNSS Galileo used', 'bool', 'Location status bit21'),
  ('subiao', 'status.gnss_beidou', 'GNSS Beidou used', 'bool', 'Inherited JT808 status'),
  ('galileosky', 'cmd.reply', 'Command reply', 'string', 'Tags 0xE0–0xE6'),
  ('galileosky', 'cmd.reply_tag', 'Command reply tag', 'string', 'Which E-tag replied'),
  ('teltonika', 'ibutton.id', 'iButton id', 'string', 'AVL 78'),
  ('jt809', 'vehicle_list', 'Vehicle list notify', 'bool', '0x1500'),
  ('jt809', 'vehicle_flag', 'Vehicle flag', 'number', '0x1500'),
  ('jt809', 'media_upload', 'Media upload', 'bool', '0x1601'),
  ('jt809', 'media_file', 'Media filename', 'string', '0x1601/0x1602')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
