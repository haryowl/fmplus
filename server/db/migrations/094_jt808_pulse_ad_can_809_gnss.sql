-- JT808 0x07/0x19 + CAN rows + terminal param hoist; JT809 GNSS alarm bits; Galileosky sensor 0x78+.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'speed.pulse', 'Pulse speed', 'number', 'TLV 0x07'),
  ('jt808', 'analog.ad', 'Analog AD', 'number', 'TLV 0x19 /100'),
  ('jt808', 'can.0.id', 'CAN id 0', 'number', '0x0705 item'),
  ('jt808', 'can.0.data', 'CAN data 0', 'string', '0x0705 hex'),
  ('jt808', 'can_parsed', 'CAN items parsed', 'number', '0x0705'),
  ('jt808', 'heartbeat.interval', 'Heartbeat interval', 'number', 'Param 0x0001'),
  ('jt808', 'report.interval', 'Report interval', 'number', 'Param 0x0020'),
  ('jt808', 'apn.main', 'Main APN', 'string', 'Param 0x0010'),
  ('jt808', 'server.main', 'Main server', 'string', 'Param 0x0013'),
  ('jt808', 'speed.max', 'Max speed', 'number', 'Param 0x0055'),
  ('jt809', 'alarm.sos', 'SOS', 'bool', 'GNSS alarm dword bit0'),
  ('jt809', 'alarm.overspeed', 'Overspeed', 'bool', 'GNSS alarm dword bit1'),
  ('galileosky', 'sensor.9', 'Sensor 9', 'number', 'Tag 0x78'),
  ('galileosky', 'sensor.10', 'Sensor 10', 'number', 'Tag 0x79')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
