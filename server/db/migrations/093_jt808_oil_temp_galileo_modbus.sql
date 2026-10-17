-- JT808 oil/cargo temp TLVs; Galileosky Modbus 3–8; din3/4 seeds.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'oil.quantity', 'Oil quantity', 'number', 'TLV 0x05 /10'),
  ('jt808', 'temp.cargo', 'Cargo temperature', 'number', 'TLV 0x06 °C×10'),
  ('jt808', 'status.din3', 'DIN3', 'bool', 'TLV 0x18 bit2'),
  ('jt808', 'status.din4', 'DIN4', 'bool', 'TLV 0x18 bit3'),
  ('galileosky', 'modbus.3', 'Modbus register 3', 'number', 'Tag 0x82'),
  ('galileosky', 'modbus.4', 'Modbus register 4', 'number', 'Tag 0x83'),
  ('galileosky', 'modbus.5', 'Modbus register 5', 'number', 'Tag 0x84'),
  ('galileosky', 'modbus.6', 'Modbus register 6', 'number', 'Tag 0x85'),
  ('galileosky', 'can.3', 'CAN value 3', 'number', 'Tag 0x66'),
  ('galileosky', 'can.4', 'CAN value 4', 'number', 'Tag 0x67')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
