-- Galileosky/JT808 gnss.sats; Teltonika/Ruptela AIN2; JT809 0x1001 login fields.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'gnss.sats', 'GNSS satellites', 'number', 'Tag 0x30 flags'),
  ('galileosky', 'gnss.fix', 'GNSS fix', 'bool', 'Tag 0x30 valid nibble'),
  ('galileosky', 'gnss.lbs', 'LBS fix', 'bool', 'Tag 0x30 LBS mode'),
  ('jt808', 'gnss.sats', 'GNSS satellites', 'number', 'TLV 0x31'),
  ('teltonika', 'voltage.ain2', 'Analog in 2', 'number', 'AVL 10'),
  ('ruptela', 'voltage.ain2', 'Analog in 2', 'number', 'IO 10'),
  ('jt809', 'platform_login', 'Platform login', 'bool', '0x1001'),
  ('jt809', 'platform_user_id', 'Platform user id', 'number', '0x1001'),
  ('jt809', 'downlink_ip', 'Downlink IP', 'string', '0x1001'),
  ('jt809', 'downlink_port', 'Downlink port', 'number', '0x1001')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
