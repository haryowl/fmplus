-- JT808 TLV 0x04 manual-confirm alarm; video dword remaps; JT809 GNSS tail; Ruptela eco/sleep.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'manual_alarm_id', 'Manual confirm alarm id', 'number', 'TLV 0x04'),
  ('jt808', 'alarm.video_overload', 'Video overload', 'bool', 'TLV 0x14 bit4'),
  ('jt808', 'alarm.video_encode', 'Video encode fault', 'bool', 'TLV 0x14 bit5'),
  ('jt808', 'alarm.video_illegal_access', 'Video illegal access', 'bool', 'TLV 0x14 bit6'),
  ('jt808', 'alarm.video_other_device', 'Video other device', 'bool', 'TLV 0x14 bit3'),
  ('jt808', 'video.alarm_word', 'Video alarm dword', 'number', 'TLV 0x14'),
  ('subiao', 'manual_alarm_id', 'Manual confirm alarm id', 'number', 'TLV 0x04'),
  ('jt809', 'gnss_altitude', 'GNSS altitude', 'number', '0x1200-family tail'),
  ('jt809', 'vehicle_state', 'Vehicle state', 'number', '0x1200-family DWORD'),
  ('jt809', 'gnss_alarm', 'GNSS alarm dword', 'number', '0x1200-family'),
  ('jt809', 'alarm.gnss', 'GNSS alarm', 'bool', 'Nonzero gnss_alarm'),
  ('jt809', 'status.acc', 'ACC', 'bool', 'vehicle_state bit0'),
  ('ruptela', 'eco.score', 'Eco score', 'number', 'IO 15'),
  ('ruptela', 'sleep.mode', 'Sleep mode', 'number', 'IO 200'),
  ('ruptela', 'ble.battery', 'BLE battery', 'number', 'IO 86'),
  ('ruptela', 'voltage.ain1', 'Analog 1', 'number', 'IO 9 mV→V')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
