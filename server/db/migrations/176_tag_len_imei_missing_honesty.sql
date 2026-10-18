-- Galileosky invalid tag length; Ruptela records without IMEI.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'tag_len_invalid', 'Tag length invalid', 'bool', 'Declared tagLen outside 1..1000'),
  ('galileosky', 'tag_len', 'Tag length', 'number', 'Declared tagLen on invalid packet'),
  ('ruptela', 'imei_missing', 'IMEI missing', 'bool', 'Records cmd 1/68 without IMEI')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
