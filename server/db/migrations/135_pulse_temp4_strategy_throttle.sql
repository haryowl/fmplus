-- JT808 drv.pulse_factor + report.strategy; Teltonika/Ruptela temp.4 + engine.throttle/runtime.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'drv.pulse_factor', 'Pulse factor', 'number', '0x0700 cmd 0x04 pulses/km'),
  ('jt808', 'report.strategy', 'Report strategy', 'number', 'Terminal param 0x0021'),
  ('subiao', 'drv.pulse_factor', 'Pulse factor', 'number', 'Inherited JT808 0x0700'),
  ('subiao', 'report.strategy', 'Report strategy', 'number', 'Inherited JT808 0x0021'),
  ('teltonika', 'temp.4', 'Temperature 4', 'number', 'AVL IO 75'),
  ('teltonika', 'engine.throttle', 'Throttle pct', 'number', 'AVL IO 41'),
  ('teltonika', 'engine.runtime', 'Engine runtime s', 'number', 'AVL IO 42'),
  ('ruptela', 'temp.4', 'Temperature 4', 'number', 'IO 75 (Teltonika-parity)'),
  ('ruptela', 'engine.throttle', 'Throttle pct', 'number', 'IO 41 (Teltonika-parity)'),
  ('ruptela', 'engine.runtime', 'Engine runtime s', 'number', 'IO 42 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
