-- JT808 register/area aliases; Teltonika/Ruptela movement; Galileosky analog 0xA0–A3.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'vehicle.province', 'Province id', 'number', '0x0100 / param 0x0081'),
  ('jt808', 'vehicle.city', 'City id', 'number', '0x0100 / param 0x0082'),
  ('jt808', 'vehicle.plate', 'Vehicle plate', 'string', '0x0100 / param 0x0083'),
  ('jt808', 'device.model', 'Terminal model', 'string', '0x0100'),
  ('jt808', 'area_query_kind', 'Area query kind', 'string', '0x0608 circle/rect/poly/route'),
  ('teltonika', 'status.movement', 'Movement', 'bool', 'AVL 240'),
  ('ruptela', 'status.movement', 'Movement', 'bool', 'IO 240'),
  ('galileosky', 'analog.10', 'Analog 10', 'number', 'Tag 0xA0'),
  ('galileosky', 'analog.11', 'Analog 11', 'number', 'Tag 0xA1')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
