-- Galileosky iButton/accel; JT808 TLV 0x32 IC card; JT809 0x1208 driver identity fields.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'ibutton.id', 'iButton id', 'string', 'Tag 0x48'),
  ('galileosky', 'accel.x', 'Accel X', 'number', 'Tag 0x5A'),
  ('galileosky', 'accel.y', 'Accel Y', 'number', 'Tag 0x5A'),
  ('galileosky', 'accel.z', 'Accel Z', 'number', 'Tag 0x5A'),
  ('jt808', 'driver.ic_status', 'IC card status', 'number', 'TLV 0x32'),
  ('jt808', 'driver.ic_login', 'IC card login', 'bool', 'TLV 0x32 → safety'),
  ('jt808', 'driver.ic_logout', 'IC card logout', 'bool', 'TLV 0x32 → safety'),
  ('jt808', 'driver.ic_name', 'IC driver name', 'string', 'TLV 0x32'),
  ('jt808', 'driver.ic_card', 'IC card number', 'string', 'TLV 0x32'),
  ('jt808', 'media_has_location', 'Media has location', 'bool', '0x0801 embedded 0x0200'),
  ('jt809', 'driver_name', 'Driver name', 'string', '0x1208'),
  ('jt809', 'driver_id', 'Driver id', 'string', '0x1208'),
  ('jt809', 'driver_licence', 'Driver licence', 'string', '0x1208'),
  ('jt809', 'driver_org', 'Driver org', 'string', '0x1208')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
