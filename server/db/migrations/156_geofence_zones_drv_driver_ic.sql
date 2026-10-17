-- Teltonika geofence zones 1–9; JT808 0x0700 driver cmds; JT809 driver.ic_* aliases.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'geofence.zone1', 'Geofence zone 1 event', 'number', 'AVL IO 155'),
  ('teltonika', 'geofence.zone2', 'Geofence zone 2 event', 'number', 'AVL IO 156'),
  ('teltonika', 'geofence.zone3', 'Geofence zone 3 event', 'number', 'AVL IO 157'),
  ('teltonika', 'geofence.zone4', 'Geofence zone 4 event', 'number', 'AVL IO 158'),
  ('teltonika', 'geofence.zone5', 'Geofence zone 5 event', 'number', 'AVL IO 159'),
  ('teltonika', 'geofence.zone6', 'Geofence zone 6 event', 'number', 'AVL IO 61'),
  ('teltonika', 'geofence.zone7', 'Geofence zone 7 event', 'number', 'AVL IO 62'),
  ('teltonika', 'geofence.zone8', 'Geofence zone 8 event', 'number', 'AVL IO 63'),
  ('teltonika', 'geofence.zone9', 'Geofence zone 9 event', 'number', 'AVL IO 64'),
  ('jt808', 'drv.driver_licence', 'Driving record licence', 'string', '0x0700 cmd 0x01'),
  ('jt808', 'drv.driver_id', 'Driving record driver id', 'string', '0x0700 cmd 0x11'),
  ('jt808', 'drv.identity_hex', 'Driving record identity hex', 'string', '0x0700 cmd 0x11 snip'),
  ('subiao', 'drv.driver_licence', 'Driving record licence', 'string', 'Inherited JT808 0x0700'),
  ('subiao', 'drv.driver_id', 'Driving record driver id', 'string', 'Inherited JT808 0x0700'),
  ('subiao', 'drv.identity_hex', 'Driving record identity hex', 'string', 'Inherited JT808 0x0700'),
  ('jt809', 'driver.ic_name', 'Driver name', 'string', '0x1208 alias'),
  ('jt809', 'driver.ic_card', 'Driver id/card', 'string', '0x1208 alias'),
  ('jt809', 'driver.ic_licence', 'Driver licence', 'string', '0x1208 alias'),
  ('jt809', 'driver.ic_org', 'Driver org', 'string', '0x1208 alias')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
