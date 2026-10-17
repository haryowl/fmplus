-- Teltonika/Ruptela safety status scalars; Galileosky CAN 0xC0–C3; JT809 history flag.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'status.towing', 'Towing', 'bool', 'AVL 246'),
  ('teltonika', 'status.crash', 'Crash', 'bool', 'AVL 247'),
  ('teltonika', 'status.geofence', 'Geofence', 'bool', 'AVL 248'),
  ('teltonika', 'status.jamming', 'Jamming', 'bool', 'AVL 249'),
  ('teltonika', 'status.unplug', 'Unplug', 'bool', 'AVL 252'),
  ('ruptela', 'status.towing', 'Towing', 'bool', 'IO 246'),
  ('ruptela', 'status.crash', 'Crash', 'bool', 'IO 247'),
  ('ruptela', 'status.unplug', 'Unplug', 'bool', 'IO 252'),
  ('galileosky', 'can.5', 'CAN channel 5', 'number', 'Tag 0xC0'),
  ('galileosky', 'can.6', 'CAN channel 6', 'number', 'Tag 0xC1'),
  ('jt809', 'location_realtime', 'Realtime location', 'bool', '0x1200'),
  ('jt809', 'location_history', 'History location', 'bool', '0x1203')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
