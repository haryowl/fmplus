-- Teltonika/Ruptela safety io_id; JT808 header/location parse honesty.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'io_id', 'Safety IO id', 'number', 'IO map key that fired safety event'),
  ('ruptela', 'io_id', 'Safety IO id', 'number', 'IO map key that fired safety event'),
  ('jt808', 'header_invalid', 'Header invalid', 'bool', 'parseMessageHeader failed'),
  ('jt808', 'frame_len', 'Frame length', 'number', 'Raw frame bytes on header fail'),
  ('jt808', 'location_invalid', 'Location invalid', 'bool', '0x0200 parseLocation failed'),
  ('jt808', 'body_len', 'Body length', 'number', '0x0200 body len on location fail'),
  ('subiao', 'header_invalid', 'Header invalid', 'bool', 'Inherited JT808'),
  ('subiao', 'frame_len', 'Frame length', 'number', 'Inherited JT808'),
  ('subiao', 'location_invalid', 'Location invalid', 'bool', 'Inherited JT808'),
  ('subiao', 'body_len', 'Body length', 'number', 'Inherited JT808')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
