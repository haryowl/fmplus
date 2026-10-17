-- JT808 0x0107 device hw/fw aliases; Teltonika Dallas temps; JT809 0x1209 photo file.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'device.iccid', 'ICCID', 'string', '0x0107'),
  ('jt808', 'device.hw_ver', 'Hardware version', 'string', '0x0107'),
  ('jt808', 'device.fw_ver', 'Firmware version', 'string', '0x0107'),
  ('teltonika', 'temp.1', 'Dallas temp 1', 'number', 'AVL 72'),
  ('teltonika', 'temp.2', 'Dallas temp 2', 'number', 'AVL 73'),
  ('teltonika', 'temp.3', 'Dallas temp 3', 'number', 'AVL 74'),
  ('jt809', 'photo_size', 'Photo size', 'number', '0x1209'),
  ('jt809', 'photo_file', 'Photo filename', 'string', '0x1209')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
