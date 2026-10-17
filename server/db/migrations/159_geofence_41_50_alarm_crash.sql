-- Teltonika geofence 41–50, alarm event, green-driving magnitude, crash trace, private mode.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'geofence.zone41', 'Geofence zone 41 event', 'number', 'AVL IO 222'),
  ('teltonika', 'geofence.zone42', 'Geofence zone 42 event', 'number', 'AVL IO 223'),
  ('teltonika', 'geofence.zone43', 'Geofence zone 43 event', 'number', 'AVL IO 224'),
  ('teltonika', 'geofence.zone44', 'Geofence zone 44 event', 'number', 'AVL IO 225'),
  ('teltonika', 'geofence.zone45', 'Geofence zone 45 event', 'number', 'AVL IO 226'),
  ('teltonika', 'geofence.zone46', 'Geofence zone 46 event', 'number', 'AVL IO 227'),
  ('teltonika', 'geofence.zone47', 'Geofence zone 47 event', 'number', 'AVL IO 228'),
  ('teltonika', 'geofence.zone48', 'Geofence zone 48 event', 'number', 'AVL IO 229'),
  ('teltonika', 'geofence.zone49', 'Geofence zone 49 event', 'number', 'AVL IO 230'),
  ('teltonika', 'geofence.zone50', 'Geofence zone 50 event', 'number', 'AVL IO 231'),
  ('teltonika', 'alarm.event', 'Alarm event', 'bool', 'AVL IO 236'),
  ('teltonika', 'green_driving.magnitude', 'Green driving magnitude', 'number', 'AVL IO 254 ×0.01 (g or rad/s)'),
  ('teltonika', 'crash.trace', 'Crash trace data', 'string', 'AVL IO 257'),
  ('teltonika', 'status.private_mode', 'Private mode', 'bool', 'AVL IO 391')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
