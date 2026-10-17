-- JT808 TLV 0x13/0x18 + named mileage/fuel; Galileosky Modbus tags; JT809 photo notify.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'mileage', 'Mileage km', 'number', 'TLV 0x01'),
  ('jt808', 'fuel.level', 'Fuel level L', 'number', 'TLV 0x02'),
  ('jt808', 'speed.extra', 'Extra speed', 'number', 'TLV 0x03'),
  ('jt808', 'alarm.route_time_short', 'Route time short', 'bool', 'TLV 0x13 result=0'),
  ('jt808', 'alarm.route_time_long', 'Route time long', 'bool', 'TLV 0x13 result≠0'),
  ('jt808', 'route_id', 'Route id', 'number', 'TLV 0x13'),
  ('jt808', 'route_drive_time', 'Route drive time', 'number', 'TLV 0x13 seconds'),
  ('jt808', 'io.status', 'IO status word', 'number', 'TLV 0x18'),
  ('jt808', 'status.din1', 'DIN1', 'bool', 'TLV 0x18 bit0'),
  ('jt808', 'status.din2', 'DIN2', 'bool', 'TLV 0x18 bit1'),
  ('galileosky', 'modbus.1', 'Modbus register 1', 'number', 'Tag 0x80'),
  ('galileosky', 'modbus.2', 'Modbus register 2', 'number', 'Tag 0x81'),
  ('jt809', 'photo_notify', 'Photo notify', 'bool', '0x1209'),
  ('jt809', 'photo_lens', 'Photo lens id', 'number', '0x1209')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
