-- JT808 gnss.upload_set + CAN channel params; JT809 info_type 29 collision_rollover; Teltonika/Ruptela engine.rpm.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'gnss.upload_set', 'GNSS upload setting', 'number', 'Terminal param 0x0095'),
  ('jt808', 'can1.collect_ms', 'CAN1 collect interval ms', 'number', 'Terminal param 0x0100'),
  ('jt808', 'can1.upload_s', 'CAN1 upload interval s', 'number', 'Terminal param 0x0101'),
  ('jt808', 'can2.collect_ms', 'CAN2 collect interval ms', 'number', 'Terminal param 0x0102'),
  ('jt808', 'can2.upload_s', 'CAN2 upload interval s', 'number', 'Terminal param 0x0103'),
  ('subiao', 'gnss.upload_set', 'GNSS upload setting', 'number', 'Inherited JT808 0x0095'),
  ('subiao', 'can1.collect_ms', 'CAN1 collect interval ms', 'number', 'Inherited JT808 0x0100'),
  ('subiao', 'can1.upload_s', 'CAN1 upload interval s', 'number', 'Inherited JT808 0x0101'),
  ('subiao', 'can2.collect_ms', 'CAN2 collect interval ms', 'number', 'Inherited JT808 0x0102'),
  ('subiao', 'can2.upload_s', 'CAN2 upload interval s', 'number', 'Inherited JT808 0x0103'),
  ('jt809', 'alarm.collision_rollover', 'Collision/rollover', 'bool', 'info_type 29 / gnss_alarm bit'),
  ('teltonika', 'engine.rpm', 'Engine RPM', 'number', 'AVL IO 36'),
  ('ruptela', 'engine.rpm', 'Engine RPM', 'number', 'IO 36 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
