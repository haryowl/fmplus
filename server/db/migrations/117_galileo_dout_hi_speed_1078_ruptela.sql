-- Galileosky DOUT8–15; speed.io/trip.odometer; Ruptela BLE/event parity; JT1078 payload meta; JT809 encrypt/BCD.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'status.outputs_hi', 'Outputs high byte', 'number', 'Tag 0x47 byte1'),
  ('galileosky', 'status.dout8', 'Digital out 8', 'bool', 'Tag 0x47 byte1 bit0'),
  ('galileosky', 'status.dout9', 'Digital out 9', 'bool', 'Tag 0x47 byte1 bit1'),
  ('galileosky', 'status.dout10', 'Digital out 10', 'bool', 'Tag 0x47 byte1 bit2'),
  ('galileosky', 'status.dout11', 'Digital out 11', 'bool', 'Tag 0x47 byte1 bit3'),
  ('galileosky', 'status.dout12', 'Digital out 12', 'bool', 'Tag 0x47 byte1 bit4'),
  ('galileosky', 'status.dout13', 'Digital out 13', 'bool', 'Tag 0x47 byte1 bit5'),
  ('galileosky', 'status.dout14', 'Digital out 14', 'bool', 'Tag 0x47 byte1 bit6'),
  ('galileosky', 'status.dout15', 'Digital out 15', 'bool', 'Tag 0x47 byte1 bit7'),
  ('teltonika', 'speed.io', 'GPS speed (IO)', 'number', 'AVL 24'),
  ('teltonika', 'trip.odometer', 'Trip odometer', 'number', 'AVL 199'),
  ('ruptela', 'speed.io', 'GPS speed (IO)', 'number', 'IO 24'),
  ('ruptela', 'trip.odometer', 'Trip odometer', 'number', 'IO 199'),
  ('ruptela', 'ble.humidity', 'BLE humidity', 'number', 'IO 29'),
  ('ruptela', 'alarm.generic', 'Generic alarm', 'bool', 'Event IO 236'),
  ('ruptela', 'alarm.ext_voltage', 'External voltage event', 'bool', 'Event IO 66'),
  ('jt1078', 'av_payload_len', 'AV payload bytes', 'number', 'parseSignalingPayload'),
  ('jt1078', 'av_payload_hex', 'AV payload snip', 'string', 'First ≤32 bytes hex'),
  ('jt1078', 'proto_msg', 'Last signaling hook', 'string', 'jt1078_signaling'),
  ('jt809', 'encrypt', 'GNSS encrypt flag', 'number', '0x120x GNSS byte0'),
  ('jt809', 'gnss_time_bcd', 'GNSS time BCD', 'string', '6-byte BCD hex')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
