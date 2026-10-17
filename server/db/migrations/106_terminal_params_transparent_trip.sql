-- JT808 terminal param hoist + transparent text; Ruptela trip.distance.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'apn.password', 'APN password', 'string', 'Param 0x0012'),
  ('jt808', 'apn.backup', 'APN backup', 'string', 'Param 0x0014'),
  ('jt808', 'phone.monitor', 'Monitor phone', 'string', 'Param 0x0040'),
  ('jt808', 'vehicle.plate', 'Vehicle plate', 'string', 'Param 0x0083'),
  ('jt808', 'vehicle.province', 'Province id', 'number', 'Param 0x0081'),
  ('jt808', 'vehicle.city', 'City id', 'number', 'Param 0x0082'),
  ('jt808', 'speed.max', 'Max speed', 'number', 'Param 0x0055'),
  ('jt808', 'transparent_text', 'Transparent text', 'string', '0x0900 ASCII'),
  ('jt808', 'transparent_kind', 'Transparent kind', 'string', '0x0900 type class'),
  ('ruptela', 'trip.distance', 'Trip distance', 'number', 'IO 250')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
