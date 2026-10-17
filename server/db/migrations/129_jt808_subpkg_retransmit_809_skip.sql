-- JT808 outbound subpkg one-seq / 0x0005 retransmit_ids / report inflection+distance hoist; JT809 encrypt-skip status.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'retransmit_ids', 'Retransmit packet IDs', 'json', '0x0005 WORD list of missing fragment indexes'),
  ('jt808', 'report.inflection_angle', 'Inflection angle', 'number', 'Terminal param 0x0023'),
  ('jt808', 'report.inflection_distance', 'Inflection distance', 'number', 'Terminal param 0x0024'),
  ('jt808', 'report.distance_interval', 'Distance report interval', 'number', 'Terminal param 0x0030'),
  ('jt808', 'report.distance_interval_night', 'Night distance interval', 'number', 'Terminal param 0x0031'),
  ('subiao', 'retransmit_ids', 'Retransmit packet IDs', 'json', 'Inherited JT808 0x0005'),
  ('subiao', 'report.inflection_angle', 'Inflection angle', 'number', 'Inherited JT808 0x0023'),
  ('subiao', 'report.inflection_distance', 'Inflection distance', 'number', 'Inherited JT808 0x0024'),
  ('subiao', 'report.distance_interval', 'Distance report interval', 'number', 'Inherited JT808 0x0030'),
  ('subiao', 'report.distance_interval_night', 'Night distance interval', 'number', 'Inherited JT808 0x0031'),
  ('jt809', 'encrypt_skip', 'Encrypted body skipped', 'bool', 'Vehicle body not decoded (no platform key)'),
  ('jt809', 'encrypt_flag', 'Encrypt flag', 'number', 'Header encrypt byte when skip')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
