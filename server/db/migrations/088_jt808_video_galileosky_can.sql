-- JT808 video alarm TLVs (0x14–0x17) + Galileosky CAN / extra sensor keys.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'alarm.video_loss', 'Video signal loss', 'bool', 'TLV 0x14/0x15'),
  ('jt808', 'alarm.video_occlude', 'Video occlude', 'bool', 'TLV 0x14/0x16'),
  ('jt808', 'alarm.video_storage', 'Video storage fault', 'bool', 'TLV 0x14/0x17'),
  ('jt808', 'video.signal_loss', 'Video loss mask', 'number', 'TLV 0x15'),
  ('jt808', 'video.signal_occlude', 'Video occlude mask', 'number', 'TLV 0x16'),
  ('jt808', 'video.storage_fault', 'Storage fault mask', 'number', 'TLV 0x17'),
  ('galileosky', 'can.1', 'CAN value 1', 'number', 'Tag 0x64'),
  ('galileosky', 'can.2', 'CAN value 2', 'number', 'Tag 0x65'),
  ('galileosky', 'sensor.5', 'Sensor 5', 'number', 'Tag 0x74'),
  ('galileosky', 'sensor.6', 'Sensor 6', 'number', 'Tag 0x75')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
