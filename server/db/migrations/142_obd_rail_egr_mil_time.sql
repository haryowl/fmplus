-- Teltonika/Ruptela OBD fuel rail pressures, EGR, MIL/codes-cleared time.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'fuel.rail_relative', 'Relative fuel rail kPa', 'number', 'AVL IO 44 ×0.1'),
  ('teltonika', 'fuel.rail_direct', 'Direct fuel rail kPa', 'number', 'AVL IO 45 ×10'),
  ('teltonika', 'fuel.rail_absolute', 'Absolute fuel rail kPa', 'number', 'AVL IO 56 ×10'),
  ('teltonika', 'engine.egr_commanded', 'Commanded EGR pct', 'number', 'AVL IO 46'),
  ('teltonika', 'engine.egr_error', 'EGR error pct', 'number', 'AVL IO 47'),
  ('teltonika', 'obd.mil_time', 'MIL on time min', 'number', 'AVL IO 54'),
  ('teltonika', 'obd.codes_cleared_time', 'Codes cleared time min', 'number', 'AVL IO 55'),
  ('ruptela', 'fuel.rail_relative', 'Relative fuel rail kPa', 'number', 'IO 44 ×0.1 (Teltonika-parity)'),
  ('ruptela', 'fuel.rail_direct', 'Direct fuel rail kPa', 'number', 'IO 45 ×10 (Teltonika-parity)'),
  ('ruptela', 'fuel.rail_absolute', 'Absolute fuel rail kPa', 'number', 'IO 56 ×10 (Teltonika-parity)'),
  ('ruptela', 'engine.egr_commanded', 'Commanded EGR pct', 'number', 'IO 46 (Teltonika-parity)'),
  ('ruptela', 'engine.egr_error', 'EGR error pct', 'number', 'IO 47 (Teltonika-parity)'),
  ('ruptela', 'obd.mil_time', 'MIL on time min', 'number', 'IO 54 (Teltonika-parity)'),
  ('ruptela', 'obd.codes_cleared_time', 'Codes cleared time min', 'number', 'IO 55 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
