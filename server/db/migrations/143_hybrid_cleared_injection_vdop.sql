-- Teltonika/Ruptela hybrid pack, codes-cleared distance, injection timing; Galileosky VDOP.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'hybrid.battery_life', 'Hybrid battery life pct', 'number', 'AVL IO 57'),
  ('teltonika', 'obd.codes_cleared_distance', 'Codes cleared distance km', 'number', 'AVL IO 49'),
  ('teltonika', 'engine.injection_timing', 'Injection timing deg', 'number', 'AVL IO 59 ×0.01'),
  ('ruptela', 'hybrid.battery_life', 'Hybrid battery life pct', 'number', 'IO 57 (Teltonika-parity)'),
  ('ruptela', 'obd.codes_cleared_distance', 'Codes cleared distance km', 'number', 'IO 49 (Teltonika-parity)'),
  ('ruptela', 'engine.injection_timing', 'Injection timing deg', 'number', 'IO 59 ×0.01 (Teltonika-parity)'),
  ('galileosky', 'vdop', 'VDOP raw', 'number', 'Tag 0x37 ×0.1'),
  ('galileosky', 'gnss.vdop', 'GNSS VDOP', 'number', 'Tag 0x37 ×0.1')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
