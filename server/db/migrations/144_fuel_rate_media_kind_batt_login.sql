-- Teltonika/Ruptela engine.fuel_rate + battery.current; JT809 media_kind; login status patch (Go).
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'engine.fuel_rate', 'Engine fuel rate L/h', 'number', 'AVL IO 60 ×0.01'),
  ('teltonika', 'battery.current', 'Battery current A', 'number', 'AVL IO 68 ×0.001'),
  ('ruptela', 'engine.fuel_rate', 'Engine fuel rate L/h', 'number', 'IO 60 ×0.01 (Teltonika-parity)'),
  ('ruptela', 'battery.current', 'Battery current A', 'number', 'IO 68 ×0.001 (Teltonika-parity)'),
  ('jt809', 'media_kind', 'Media kind', 'string', '0x1601/0x1602 via HoistMediaKind'),
  ('jt809', 'platform_login', 'Platform login', 'bool', '0x1001 PatchLastStatus')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
