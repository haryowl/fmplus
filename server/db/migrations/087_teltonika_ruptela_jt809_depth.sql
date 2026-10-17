-- Teltonika/Ruptela IO safety parity + JT809 expanded alarm info_type / 1207/1210 status keys.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'alarm.autogeofence', 'Autogeofence', 'bool', 'AVL 248'),
  ('teltonika', 'alarm.trip', 'Trip', 'bool', 'AVL 250/254'),
  ('teltonika', 'green_driving.value', 'Green driving type', 'number', 'AVL 253'),
  ('teltonika', 'green_driving.duration', 'Green driving duration', 'number', 'AVL 243'),
  ('ruptela', 'alarm.autogeofence', 'Autogeofence', 'bool', 'IO 248'),
  ('ruptela', 'alarm.trip', 'Trip', 'bool', 'IO 250/254'),
  ('ruptela', 'alarm.green_driving', 'Green driving', 'bool', 'IO 253'),
  ('ruptela', 'accel.x', 'Accel X', 'number', 'IO 17'),
  ('ruptela', 'accel.y', 'Accel Y', 'number', 'IO 18'),
  ('ruptela', 'accel.z', 'Accel Z', 'number', 'IO 19'),
  ('ruptela', 'ble.temp1', 'BLE temp 1', 'number', 'IO 25 °C×10'),
  ('ruptela', 'green_driving.value', 'Green driving type', 'number', 'IO 253'),
  ('ruptela', 'green_driving.duration', 'Green driving duration', 'number', 'IO 243'),
  ('jt809', 'media_attach', 'Media attach notify', 'bool', '0x1210'),
  ('jt809', 'attach_info_len', 'Attach info length', 'number', '0x1210'),
  ('jt809', 'alarm.route_deviation', 'Route deviation', 'bool', 'info_type 22'),
  ('jt809', 'alarm.collision', 'Collision', 'bool', 'info_type 28'),
  ('jt809', 'alarm.theft', 'Theft', 'bool', 'info_type 25')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
