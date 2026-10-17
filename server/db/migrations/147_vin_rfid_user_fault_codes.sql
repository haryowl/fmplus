-- Teltonika VIN/RFID/user/fault codes; Ruptela RFID/user parity.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'vehicle.vin', 'Vehicle VIN', 'string', 'AVL IO 256 ASCII'),
  ('teltonika', 'rfid.id', 'RFID ID', 'string', 'AVL IO 207'),
  ('teltonika', 'user.id', 'User ID', 'string', 'AVL IO 238'),
  ('teltonika', 'obd.fault_codes', 'OBD fault codes', 'string', 'AVL IO 281 ASCII DTCs'),
  ('ruptela', 'rfid.id', 'RFID ID', 'string', 'IO 207 (Teltonika-parity)'),
  ('ruptela', 'user.id', 'User ID', 'string', 'IO 238 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
