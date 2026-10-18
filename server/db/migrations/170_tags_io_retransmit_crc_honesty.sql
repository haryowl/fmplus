-- Galileosky tags/0xff catalog; JT808/Su Biao retransmit_len; Teltonika/Ruptela raw io; CRC honesty.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'tags', 'Raw tag map', 'json', 'All parsed tags keyed 0xNN'),
  ('galileosky', 'tag.0xff', 'Opaque remainder', 'string', 'Unknown/truncated tag stream hex'),
  ('jt808', 'retransmit_len', 'Retransmit body length', 'number', '0x0005 body byte length'),
  ('subiao', 'retransmit_len', 'Retransmit body length', 'number', 'Inherited JT808 0x0005'),
  ('teltonika', 'io', 'Raw IO map', 'json', 'AVL IO id to value map'),
  ('ruptela', 'io', 'Raw IO map', 'json', 'Record IO id to value map'),
  ('teltonika', 'crc_invalid', 'CRC invalid', 'bool', 'AVL frame CRC mismatch'),
  ('teltonika', 'crc_got', 'CRC received', 'number', 'CRC bytes as uint32'),
  ('teltonika', 'crc_want', 'CRC expected', 'number', 'crc16IBM of payload'),
  ('ruptela', 'crc_invalid', 'CRC invalid', 'bool', 'Packet CRC mismatch'),
  ('ruptela', 'crc_got', 'CRC received', 'number', 'Trailer CRC'),
  ('ruptela', 'crc_want', 'CRC expected', 'number', 'crc16Kermit of data'),
  ('galileosky', 'crc_invalid', 'CRC invalid', 'bool', 'Packet CRC mismatch'),
  ('galileosky', 'crc_got', 'CRC received', 'number', 'Trailer CRC'),
  ('galileosky', 'crc_want', 'CRC expected', 'number', 'crc16Modbus of header+tags')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
