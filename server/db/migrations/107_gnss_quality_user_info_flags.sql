-- Teltonika/Ruptela GNSS quality; Galileosky user.4–8; JT808 info order flags.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'gnss.pdop', 'GNSS PDOP', 'number', 'AVL 181'),
  ('teltonika', 'gnss.hdop', 'GNSS HDOP', 'number', 'AVL 182'),
  ('teltonika', 'gnss.status', 'GNSS status', 'number', 'AVL 69'),
  ('ruptela', 'gnss.pdop', 'GNSS PDOP', 'number', 'IO 181'),
  ('ruptela', 'gnss.hdop', 'GNSS HDOP', 'number', 'IO 182'),
  ('galileosky', 'user.4', 'User tag 4', 'number', 'Tag 0x15'),
  ('galileosky', 'user.8', 'User tag 8', 'number', 'Tag 0x19'),
  ('jt808', 'info_ordered', 'Info ordered', 'bool', '0x0303 flag=1'),
  ('jt808', 'info_canceled', 'Info canceled', 'bool', '0x0303 flag=0'),
  ('jt808', 'answer.text', 'Question answer text', 'string', '0x0302')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
