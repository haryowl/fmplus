-- JT808 photo timing/distance; Teltonika/Ruptela OBD DTC/ambient/baro/ECU voltage.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'photo.timing', 'Photo timing control', 'number', 'Terminal param 0x0064'),
  ('jt808', 'photo.distance', 'Photo distance control', 'number', 'Terminal param 0x0065'),
  ('subiao', 'photo.timing', 'Photo timing control', 'number', 'Inherited JT808 0x0064'),
  ('subiao', 'photo.distance', 'Photo distance control', 'number', 'Inherited JT808 0x0065'),
  ('teltonika', 'obd.dtc_count', 'DTC count', 'number', 'AVL IO 30'),
  ('teltonika', 'engine.ambient_temp', 'Ambient air temp C', 'number', 'AVL IO 53'),
  ('teltonika', 'engine.baro', 'Barometric pressure kPa', 'number', 'AVL IO 50'),
  ('teltonika', 'obd.ecu_voltage', 'ECU voltage V', 'number', 'AVL IO 51 ×0.001'),
  ('ruptela', 'obd.dtc_count', 'DTC count', 'number', 'IO 30 (Teltonika-parity)'),
  ('ruptela', 'engine.ambient_temp', 'Ambient air temp C', 'number', 'IO 53 (Teltonika-parity)'),
  ('ruptela', 'engine.baro', 'Barometric pressure kPa', 'number', 'IO 50 (Teltonika-parity)'),
  ('ruptela', 'obd.ecu_voltage', 'ECU voltage V', 'number', 'IO 51 ×0.001 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
