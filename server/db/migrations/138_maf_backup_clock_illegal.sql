-- Teltonika/Ruptela engine.maf; JT808 backup dial/addr, drv.clock, illegal drive window.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'engine.maf', 'MAF g/s', 'number', 'AVL IO 40 ×0.01'),
  ('ruptela', 'engine.maf', 'MAF g/s', 'number', 'IO 40 ×0.01 (Teltonika-parity)'),
  ('jt808', 'server.backup_dial', 'Backup dial number', 'string', 'Terminal param 0x0025'),
  ('jt808', 'server.backup_addr', 'Backup addr', 'string', 'Terminal param 0x0026'),
  ('jt808', 'drv.clock', 'Driving record clock', 'string', '0x0700 cmd 0x02 RFC3339'),
  ('jt808', 'illegal.drive_start', 'Illegal drive start', 'string', 'Terminal param 0x0032 HH:MM'),
  ('jt808', 'illegal.drive_end', 'Illegal drive end', 'string', 'Terminal param 0x0032 HH:MM'),
  ('jt808', 'illegal.drive_window', 'Illegal drive window', 'string', 'Terminal param 0x0032 start-end'),
  ('subiao', 'server.backup_dial', 'Backup dial number', 'string', 'Inherited JT808 0x0025'),
  ('subiao', 'server.backup_addr', 'Backup addr', 'string', 'Inherited JT808 0x0026'),
  ('subiao', 'drv.clock', 'Driving record clock', 'string', 'Inherited JT808 0x0700'),
  ('subiao', 'illegal.drive_start', 'Illegal drive start', 'string', 'Inherited JT808 0x0032'),
  ('subiao', 'illegal.drive_end', 'Illegal drive end', 'string', 'Inherited JT808 0x0032'),
  ('subiao', 'illegal.drive_window', 'Illegal drive window', 'string', 'Inherited JT808 0x0032')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
