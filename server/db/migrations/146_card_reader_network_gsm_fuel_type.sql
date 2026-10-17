-- JT808 status.card_reader; Teltonika/Ruptela network.type, gsm cell/LAC, fuel.type.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'status.card_reader', 'Card reader connected', 'bool', 'Location TLV 0x25 bit5'),
  ('subiao', 'status.card_reader', 'Card reader connected', 'bool', 'Inherited JT808 0x25 bit5'),
  ('teltonika', 'network.type', 'Network type', 'number', 'AVL IO 237'),
  ('teltonika', 'gsm.cell_id', 'GSM cell ID', 'number', 'AVL IO 205'),
  ('teltonika', 'gsm.lac', 'GSM LAC', 'number', 'AVL IO 206'),
  ('teltonika', 'fuel.type', 'Fuel type', 'number', 'AVL IO 759'),
  ('ruptela', 'network.type', 'Network type', 'number', 'IO 237 (Teltonika-parity)'),
  ('ruptela', 'gsm.cell_id', 'GSM cell ID', 'number', 'IO 205 (Teltonika-parity)'),
  ('ruptela', 'gsm.lac', 'GSM LAC', 'number', 'IO 206 (Teltonika-parity)'),
  ('ruptela', 'fuel.type', 'Fuel type', 'number', 'IO 759 (Teltonika-parity)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
