-- Teltonika geofence 12–20 + auto; Dallas temp IDs; JT808 0x0700 vehicle/speed hex.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'geofence.zone12', 'Geofence zone 12 event', 'number', 'AVL IO 88'),
  ('teltonika', 'geofence.zone13', 'Geofence zone 13 event', 'number', 'AVL IO 91'),
  ('teltonika', 'geofence.zone14', 'Geofence zone 14 event', 'number', 'AVL IO 92'),
  ('teltonika', 'geofence.zone15', 'Geofence zone 15 event', 'number', 'AVL IO 93'),
  ('teltonika', 'geofence.zone16', 'Geofence zone 16 event', 'number', 'AVL IO 94'),
  ('teltonika', 'geofence.zone17', 'Geofence zone 17 event', 'number', 'AVL IO 95'),
  ('teltonika', 'geofence.zone18', 'Geofence zone 18 event', 'number', 'AVL IO 96'),
  ('teltonika', 'geofence.zone19', 'Geofence zone 19 event', 'number', 'AVL IO 97'),
  ('teltonika', 'geofence.zone20', 'Geofence zone 20 event', 'number', 'AVL IO 98'),
  ('teltonika', 'geofence.auto', 'Auto geofence event', 'number', 'AVL IO 175'),
  ('teltonika', 'temp.id1', 'Dallas temp ID 1', 'string', 'AVL IO 76'),
  ('teltonika', 'temp.id2', 'Dallas temp ID 2', 'string', 'AVL IO 77'),
  ('teltonika', 'temp.id3', 'Dallas temp ID 3', 'string', 'AVL IO 79'),
  ('jt808', 'drv.vehicle_info_hex', 'Driving record vehicle info hex', 'string', '0x0700 cmd 0x05'),
  ('jt808', 'drv.speed_log_hex', 'Driving record speed log hex', 'string', '0x0700 cmd 0x08'),
  ('subiao', 'drv.vehicle_info_hex', 'Driving record vehicle info hex', 'string', 'Inherited JT808 0x0700'),
  ('subiao', 'drv.speed_log_hex', 'Driving record speed log hex', 'string', 'Inherited JT808 0x0700')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
