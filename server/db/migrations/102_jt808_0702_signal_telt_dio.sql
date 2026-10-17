-- JT808 0x0702 driver safety aliases + TLV 0x25 turn/brake; Teltonika/Ruptela DIN/DOUT.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'driver.ic_login', 'Driver IC login', 'bool', '0x0702 / TLV 0x32 → safety'),
  ('jt808', 'driver.ic_logout', 'Driver IC logout', 'bool', '0x0702 / TLV 0x32 → safety'),
  ('jt808', 'status.left_turn', 'Left turn', 'bool', 'TLV 0x25'),
  ('jt808', 'status.right_turn', 'Right turn', 'bool', 'TLV 0x25'),
  ('jt808', 'status.wiper', 'Wiper', 'bool', 'TLV 0x25'),
  ('jt808', 'status.brake', 'Brake', 'bool', 'TLV 0x25'),
  ('jt808', 'status.fog', 'Fog lamp', 'bool', 'TLV 0x25'),
  ('jt808', 'status.position_lamp', 'Position lamp', 'bool', 'TLV 0x25'),
  ('subiao', 'status.left_turn', 'Left turn', 'bool', 'Inherited JT808 TLV 0x25'),
  ('teltonika', 'status.din1', 'Digital in 1', 'bool', 'AVL 1'),
  ('teltonika', 'status.din2', 'Digital in 2', 'bool', 'AVL 2'),
  ('teltonika', 'status.dout1', 'Digital out 1', 'bool', 'AVL 179'),
  ('teltonika', 'status.dout2', 'Digital out 2', 'bool', 'AVL 180'),
  ('ruptela', 'status.din1', 'Digital in 1', 'bool', 'IO 1'),
  ('ruptela', 'status.dout1', 'Digital out 1', 'bool', 'IO 179')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
