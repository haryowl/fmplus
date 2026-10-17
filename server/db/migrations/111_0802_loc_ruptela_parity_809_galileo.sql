-- JT808 0x0802 location; Ruptela overspeed/ICCID; JT809 0x1202 supplement; Galileosky power_ext/hdop.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'media_has_location', 'Media has location', 'bool', '0x0800/0x0801/0x0802'),
  ('ruptela', 'overspeed.threshold', 'Overspeed threshold', 'number', 'IO 255'),
  ('ruptela', 'gsm.iccid', 'ICCID hint', 'string', 'IO 11'),
  ('ruptela', 'status.geofence', 'Geofence', 'bool', 'IO 248'),
  ('ruptela', 'status.jamming', 'Jamming', 'bool', 'IO 249'),
  ('jt809', 'location_supplement', 'Supplement location', 'bool', '0x1202'),
  ('galileosky', 'gnss.hdop', 'GNSS HDOP', 'number', 'Tag 0x35'),
  ('galileosky', 'alarm.power_ext', 'External power alarm', 'bool', 'Tag 0x44 bit0 → safety')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
