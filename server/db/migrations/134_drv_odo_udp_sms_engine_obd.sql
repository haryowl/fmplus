-- JT808 0x0700 drv.odometer + UDP/SMS timeout params; Teltonika/Ruptela engine.coolant_temp + engine.load.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'drv.odometer', 'Driving record odometer', 'number', '0x0700 cmd 0x03 unit 0.1 km'),
  ('jt808', 'udp.timeout', 'UDP timeout', 'number', 'Terminal param 0x0004'),
  ('jt808', 'udp.retry', 'UDP retry', 'number', 'Terminal param 0x0005'),
  ('jt808', 'sms.timeout', 'SMS timeout', 'number', 'Terminal param 0x0006'),
  ('jt808', 'sms.retry', 'SMS retry', 'number', 'Terminal param 0x0007'),
  ('subiao', 'drv.odometer', 'Driving record odometer', 'number', 'Inherited JT808 0x0700'),
  ('subiao', 'udp.timeout', 'UDP timeout', 'number', 'Inherited JT808 0x0004'),
  ('subiao', 'udp.retry', 'UDP retry', 'number', 'Inherited JT808 0x0005'),
  ('subiao', 'sms.timeout', 'SMS timeout', 'number', 'Inherited JT808 0x0006'),
  ('subiao', 'sms.retry', 'SMS retry', 'number', 'Inherited JT808 0x0007'),
  ('teltonika', 'engine.coolant_temp', 'Coolant temp C', 'number', 'AVL IO 32'),
  ('teltonika', 'engine.load', 'Engine load pct', 'number', 'AVL IO 31'),
  ('ruptela', 'engine.coolant_temp', 'Coolant temp C', 'number', 'IO 32 (Teltonika-parity)'),
  ('ruptela', 'engine.load', 'Engine load pct', 'number', 'IO 31 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
