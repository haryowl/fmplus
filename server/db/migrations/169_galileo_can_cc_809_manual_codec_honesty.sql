-- Galileosky can.25-28/tag.0xcc-cf; JT809 manual_alarm_id + info_type_unmapped; Teltonika codec_unsupported.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'can.25', 'CAN channel 25', 'number', 'Tag 0xcc'),
  ('galileosky', 'can.26', 'CAN channel 26', 'number', 'Tag 0xcd'),
  ('galileosky', 'can.27', 'CAN channel 27', 'number', 'Tag 0xce'),
  ('galileosky', 'can.28', 'CAN channel 28', 'number', 'Tag 0xcf'),
  ('galileosky', 'tag.0xcc', 'CAN tag 0xcc', 'number', 'Tag 0xcc'),
  ('galileosky', 'tag.0xcd', 'CAN tag 0xcd', 'number', 'Tag 0xcd'),
  ('galileosky', 'tag.0xce', 'CAN tag 0xce', 'number', 'Tag 0xce'),
  ('galileosky', 'tag.0xcf', 'CAN tag 0xcf', 'number', 'Tag 0xcf'),
  ('jt809', 'manual_alarm_id', 'Manual confirm alarm id', 'number', 'Trailing TLV 0x04'),
  ('teltonika', 'codec_unsupported', 'Unsupported AVL codec', 'bool', 'Unknown codec byte'),
  ('jt809', 'info_type_unmapped', 'Unmapped info_type', 'bool', '0x1400 info_type not in knownInfoTypes')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
