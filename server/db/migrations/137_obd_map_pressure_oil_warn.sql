-- Teltonika/Ruptela OBD MAP/fuel pressure/oil temp; JT808 overspeed.warn_delta 0x005B.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'engine.map', 'Intake MAP kPa', 'number', 'AVL IO 35'),
  ('teltonika', 'fuel.pressure', 'Fuel pressure kPa', 'number', 'AVL IO 34'),
  ('teltonika', 'engine.oil_temp', 'Engine oil temp C', 'number', 'AVL IO 58'),
  ('ruptela', 'engine.map', 'Intake MAP kPa', 'number', 'IO 35 (Teltonika-parity)'),
  ('ruptela', 'fuel.pressure', 'Fuel pressure kPa', 'number', 'IO 34 (Teltonika-parity)'),
  ('ruptela', 'engine.oil_temp', 'Engine oil temp C', 'number', 'IO 58 (Teltonika-parity)'),
  ('jt808', 'overspeed.warn_delta', 'Overspeed warn delta', 'number', 'Terminal param 0x005B (0.1 km/h)'),
  ('subiao', 'overspeed.warn_delta', 'Overspeed warn delta', 'number', 'Inherited JT808 0x005B')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
