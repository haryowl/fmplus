-- JT808 distance-interval siblings + parking/fatigue params; Teltonika/Ruptela speed.obd + engine.intake_temp.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'report.distance_interval_default', 'Default distance interval', 'number', 'Terminal param 0x002C'),
  ('jt808', 'report.distance_interval_unlogin', 'Unlogin distance interval', 'number', 'Terminal param 0x002D'),
  ('jt808', 'report.distance_interval_dormant', 'Dormant distance interval', 'number', 'Terminal param 0x002E'),
  ('jt808', 'report.distance_interval_urgent', 'Urgent distance interval', 'number', 'Terminal param 0x002F'),
  ('jt808', 'parking.max_sec', 'Max parking seconds', 'number', 'Terminal param 0x005A'),
  ('jt808', 'fatigue.warn_delta', 'Fatigue warn delta', 'number', 'Terminal param 0x005C'),
  ('subiao', 'report.distance_interval_default', 'Default distance interval', 'number', 'Inherited JT808 0x002C'),
  ('subiao', 'report.distance_interval_unlogin', 'Unlogin distance interval', 'number', 'Inherited JT808 0x002D'),
  ('subiao', 'report.distance_interval_dormant', 'Dormant distance interval', 'number', 'Inherited JT808 0x002E'),
  ('subiao', 'report.distance_interval_urgent', 'Urgent distance interval', 'number', 'Inherited JT808 0x002F'),
  ('subiao', 'parking.max_sec', 'Max parking seconds', 'number', 'Inherited JT808 0x005A'),
  ('subiao', 'fatigue.warn_delta', 'Fatigue warn delta', 'number', 'Inherited JT808 0x005C'),
  ('teltonika', 'speed.obd', 'OBD speed km/h', 'number', 'AVL IO 37'),
  ('teltonika', 'engine.intake_temp', 'Intake air temp C', 'number', 'AVL IO 39'),
  ('ruptela', 'speed.obd', 'OBD speed km/h', 'number', 'IO 37 (Teltonika-parity)'),
  ('ruptela', 'engine.intake_temp', 'Intake air temp C', 'number', 'IO 39 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
