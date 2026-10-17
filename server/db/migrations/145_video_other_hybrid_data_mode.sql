-- JT808 video_other_device safety wiring (Go); Teltonika/Ruptela hybrid system V/A, data mode, fuel-air equivalence.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'hybrid.system_voltage', 'Hybrid system voltage', 'number', 'AVL IO 543'),
  ('teltonika', 'hybrid.system_current', 'Hybrid system current A', 'number', 'AVL IO 544 signed'),
  ('teltonika', 'network.data_mode', 'Data mode', 'number', 'AVL IO 80'),
  ('teltonika', 'fuel.air_equivalence', 'Fuel-air equivalence', 'number', 'AVL IO 541 ×0.01'),
  ('ruptela', 'hybrid.system_voltage', 'Hybrid system voltage', 'number', 'IO 543 (Teltonika-parity)'),
  ('ruptela', 'hybrid.system_current', 'Hybrid system current A', 'number', 'IO 544 signed (Teltonika-parity)'),
  ('ruptela', 'network.data_mode', 'Data mode', 'number', 'IO 80 (Teltonika-parity)'),
  ('ruptela', 'fuel.air_equivalence', 'Fuel-air equivalence', 'number', 'IO 541 ×0.01 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
