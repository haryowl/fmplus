-- JT808 IC-auth server params 0x001B-1F; Teltonika/Ruptela short fuel trim, timing advance, MIL distance.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'ic.auth_apn', 'IC auth APN', 'string', 'Terminal param 0x001B'),
  ('jt808', 'ic.auth_user', 'IC auth user', 'string', 'Terminal param 0x001C'),
  ('jt808', 'ic.auth_password', 'IC auth password', 'string', 'Terminal param 0x001D'),
  ('jt808', 'ic.auth_addr', 'IC auth address', 'string', 'Terminal param 0x001E'),
  ('jt808', 'ic.auth_tcp_port', 'IC auth TCP port', 'number', 'Terminal param 0x001F'),
  ('subiao', 'ic.auth_apn', 'IC auth APN', 'string', 'Inherited JT808 0x001B'),
  ('subiao', 'ic.auth_user', 'IC auth user', 'string', 'Inherited JT808 0x001C'),
  ('subiao', 'ic.auth_password', 'IC auth password', 'string', 'Inherited JT808 0x001D'),
  ('subiao', 'ic.auth_addr', 'IC auth address', 'string', 'Inherited JT808 0x001E'),
  ('subiao', 'ic.auth_tcp_port', 'IC auth TCP port', 'number', 'Inherited JT808 0x001F'),
  ('teltonika', 'engine.short_fuel_trim', 'Short fuel trim pct', 'number', 'AVL IO 33'),
  ('teltonika', 'engine.timing_advance', 'Timing advance deg', 'number', 'AVL IO 38'),
  ('teltonika', 'obd.mil_distance', 'MIL distance km', 'number', 'AVL IO 43'),
  ('ruptela', 'engine.short_fuel_trim', 'Short fuel trim pct', 'number', 'IO 33 (Teltonika-parity)'),
  ('ruptela', 'engine.timing_advance', 'Timing advance deg', 'number', 'IO 38 (Teltonika-parity)'),
  ('ruptela', 'obd.mil_distance', 'MIL distance km', 'number', 'IO 43 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
