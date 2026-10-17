-- Subiao door/circuit/upgrade inherit; Ruptela odometer catalog.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('subiao', 'status.door1', 'Door 1 open', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.door2', 'Door 2 open', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.door_lock', 'Door locked', 'bool', 'Inherited JT808 status'),
  ('subiao', 'status.circuit_cut', 'Electric circuit cut', 'bool', 'Inherited JT808 status'),
  ('subiao', 'upgrade_ok', 'Upgrade OK', 'bool', 'Inherited JT808 0x0108'),
  ('subiao', 'upgrade_kind', 'Upgrade kind', 'number', 'Inherited JT808 0x0108'),
  ('ruptela', 'odometer', 'Odometer', 'number', 'IO 65 or IO 199÷1000')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
