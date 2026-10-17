-- JT809 status.gps + gnss_time; JT808 media_kind + 0x0301 route/road alarms; Ruptela header HDOP + IO16 odo.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt809', 'status.gps', 'GPS positioned', 'bool', 'Vehicle state bit 1'),
  ('jt809', 'gnss_time', 'GNSS time RFC3339', 'string', 'Parsed from gnss_time_bcd'),
  ('jt808', 'media_kind', 'Media kind', 'string', 'picture/audio/video from media_type'),
  ('jt808', 'alarm.enter_route', 'Enter route', 'bool', '0x0301 event id 7'),
  ('jt808', 'alarm.leave_route', 'Leave route', 'bool', '0x0301 event id 8'),
  ('jt808', 'alarm.overspeed_road', 'Road overspeed', 'bool', '0x0301 event id 9'),
  ('jt808', 'alarm.underspeed_road', 'Road underspeed', 'bool', '0x0301 event id 10'),
  ('jt808', 'alarm.depart_route', 'Depart route', 'bool', '0x0301 event id 11'),
  ('subiao', 'media_kind', 'Media kind', 'string', 'Inherited JT808 media_type'),
  ('subiao', 'alarm.enter_route', 'Enter route', 'bool', 'Inherited JT808 0x0301'),
  ('subiao', 'alarm.leave_route', 'Leave route', 'bool', 'Inherited JT808 0x0301'),
  ('subiao', 'alarm.overspeed_road', 'Road overspeed', 'bool', 'Inherited JT808 0x0301'),
  ('subiao', 'alarm.underspeed_road', 'Road underspeed', 'bool', 'Inherited JT808 0x0301'),
  ('subiao', 'alarm.depart_route', 'Depart route', 'bool', 'Inherited JT808 0x0301'),
  ('ruptela', 'gnss.hdop', 'GNSS HDOP', 'number', 'Header byte/10 or IO 182/10'),
  ('ruptela', 'odometer', 'Odometer', 'number', 'IO 65, 16, or 199/1000')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
