-- JT809 CRC honesty; JT808/Su Biao seq + jt808_ver catalog (seq also backfills 171 race).
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt809', 'crc_invalid', 'CRC invalid', 'bool', '0x5B frame CRC mismatch'),
  ('jt808', 'seq', 'Message sequence', 'number', 'Header seq / BCC-fail seq'),
  ('subiao', 'seq', 'Message sequence', 'number', 'Inherited JT808'),
  ('jt808', 'jt808_ver', 'JT808 version', 'string', 'Session meta 2019 when version bit set'),
  ('subiao', 'jt808_ver', 'JT808 version', 'string', 'Inherited JT808 session meta')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
