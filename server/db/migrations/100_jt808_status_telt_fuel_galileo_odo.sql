-- JT808 location status bits; Teltonika/Ruptela fuel+ignition; Galileosky odometer/archive.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'status.oil_cut', 'Oil circuit cut', 'bool', 'Location status bit10'),
  ('jt808', 'status.circuit_cut', 'Electric circuit cut', 'bool', 'Location status bit11'),
  ('jt808', 'status.door_lock', 'Door locked', 'bool', 'Location status bit12'),
  ('jt808', 'status.door1', 'Door 1 open', 'bool', 'Location status bit13'),
  ('jt808', 'status.door2', 'Door 2 open', 'bool', 'Location status bit14'),
  ('jt808', 'status.out_of_service', 'Out of service', 'bool', 'Location status bit4'),
  ('subiao', 'status.oil_cut', 'Oil circuit cut', 'bool', 'Inherited JT808 status'),
  ('teltonika', 'fuel.level', 'Fuel level', 'number', 'AVL 89'),
  ('teltonika', 'status.ignition', 'Ignition', 'bool', 'AVL 239/1'),
  ('teltonika', 'odometer', 'Odometer', 'number', 'AVL 16'),
  ('ruptela', 'status.ignition', 'Ignition', 'bool', 'IO 239/5'),
  ('galileosky', 'odometer', 'Odometer', 'number', 'Tag 0xD4'),
  ('galileosky', 'archive.record', 'Archive record', 'number', 'Tag 0x10')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
