-- Subiao status inherit; Galileosky ext44/45 + sensors 7/8/11/12; Teltonika geofence/unplug/movement.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('subiao', 'status.out_of_service', 'Out of service', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.load_half', 'Load half', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.load_full', 'Load full', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.gnss_gps', 'GNSS GPS', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.gnss_glonass', 'GNSS GLONASS', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.gnss_galileo', 'GNSS Galileo', 'bool', 'Inherited JT808 status'),
  ('galileosky', 'status.ext44', 'Status tag 0x44', 'number', 'Tag 0x44 byte0 before alarm bits'),
  ('galileosky', 'status.ext45', 'Status tag 0x45', 'number', 'Tag 0x45 byte0 before alarm bits'),
  ('galileosky', 'sensor.7', 'Sensor 7', 'number', 'Tag 0x76'),
  ('galileosky', 'sensor.8', 'Sensor 8', 'number', 'Tag 0x77'),
  ('galileosky', 'sensor.11', 'Sensor 11', 'number', 'Tag 0x7a'),
  ('galileosky', 'sensor.12', 'Sensor 12', 'number', 'Tag 0x7b'),
  ('teltonika', 'alarm.geofence', 'Geofence', 'bool', 'AVL event IO 175'),
  ('teltonika', 'alarm.unplug', 'Unplug', 'bool', 'AVL event IO 252'),
  ('teltonika', 'alarm.movement', 'Movement', 'bool', 'AVL event IO 240')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
