-- Correct Galileosky user data (0xE2–0xE9) and Modbus (0xFE extended) catalog semantics.
-- Prior seeds wrongly mapped user.* to 0x11–0x2f and modbus.* to DS1923 tags 0x80–0x87.

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'cmd.id', 'Command number', 'number', 'Tag 0xE0 uint32 server↔device'),
  ('galileosky', 'user.array_hex', 'User data array', 'string', 'Tag 0xEA length-prefixed hex'),
  ('galileosky', 'tag.0xea', 'User array tag', 'string', 'Tag 0xEA'),
  ('galileosky', 'tag.0xeb', 'Binary cmd reply', 'string', 'Tag 0xEB length-prefixed'),
  ('galileosky', 'tag.0xfe', 'Extended tags present', 'bool', 'Tag 0xFE container'),
  ('galileosky', 'modbus.0', 'Modbus register 0', 'number', 'FE ext 0x01'),
  ('galileosky', 'modbus.9', 'Modbus register 9', 'number', 'FE ext 0x0A'),
  ('galileosky', 'modbus.32', 'Modbus register 32', 'number', 'FE ext 0x61'),
  ('galileosky', 'ble.0', 'Bluetooth sensor 0', 'number', 'FE ext 0x21'),
  ('galileosky', 'gsm.cellid', 'GSM cell id', 'number', 'FE ext 0x81'),
  ('galileosky', 'gsm.lac', 'GSM LAC', 'number', 'FE ext 0x82'),
  ('galileosky', 'gsm.mcc', 'GSM MCC', 'number', 'FE ext 0x83'),
  ('galileosky', 'gsm.mnc', 'GSM MNC', 'number', 'FE ext 0x84'),
  ('galileosky', 'gsm.signal_dbm', 'GSM RSSI dBm', 'number', 'FE ext 0x85'),
  ('galileosky', 'ds1923.1.temp', 'DS1923 1 temp', 'number', 'Tag 0x81'),
  ('galileosky', 'ds1923.1.humidity', 'DS1923 1 humidity', 'number', 'Tag 0x81')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

UPDATE tracker_protocol_params SET description = 'Tag 0xE2 uint32 user data 0'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.0';
UPDATE tracker_protocol_params SET description = 'Tag 0xE3 uint32 user data 1'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.1';
UPDATE tracker_protocol_params SET description = 'Tag 0xE4 uint32 user data 2'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.2';
UPDATE tracker_protocol_params SET description = 'Tag 0xE5 uint32 user data 3'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.3';
UPDATE tracker_protocol_params SET description = 'Tag 0xE6 uint32 user data 4'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.4';
UPDATE tracker_protocol_params SET description = 'Tag 0xE7 uint32 user data 5'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.5';
UPDATE tracker_protocol_params SET description = 'Tag 0xE8 uint32 user data 6'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.6';
UPDATE tracker_protocol_params SET description = 'Tag 0xE9 uint32 user data 7'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.7';
UPDATE tracker_protocol_params SET description = 'Legacy key — not official user data (was Tag 0x19)'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.8';
UPDATE tracker_protocol_params SET description = 'Legacy key — not official user data (was Tag 0x21)'
  WHERE protocol = 'galileosky' AND vendor_key = 'user.9';

UPDATE tracker_protocol_params SET description = 'FE extended tag 0x02 (was wrongly Tag 0x80 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.1';
UPDATE tracker_protocol_params SET description = 'FE extended tag 0x03 (was wrongly Tag 0x81 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.2';
UPDATE tracker_protocol_params SET description = 'FE extended tag 0x04 (was wrongly Tag 0x82 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.3';
UPDATE tracker_protocol_params SET description = 'FE extended tag 0x05 (was wrongly Tag 0x83 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.4';
UPDATE tracker_protocol_params SET description = 'FE extended tag 0x06 (was wrongly Tag 0x84 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.5';
UPDATE tracker_protocol_params SET description = 'FE extended tag 0x07 (was wrongly Tag 0x85 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.6';
UPDATE tracker_protocol_params SET description = 'FE extended tag 0x08 (was wrongly Tag 0x86 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.7';
UPDATE tracker_protocol_params SET description = 'FE extended tag 0x09 (was wrongly Tag 0x87 DS1923)'
  WHERE protocol = 'galileosky' AND vendor_key = 'modbus.8';

UPDATE tracker_protocol_params SET description = 'Obsolete — Modbus is FE 0x01–0x20 / 0x61–0x80, not 8-byte 0x80'
  WHERE protocol = 'galileosky' AND vendor_key LIKE 'modbus.%_hi';

UPDATE tracker_protocol_params SET description = 'Tag 0xE1 length-prefixed CP1251 text (not 0xE0–0xE6)'
  WHERE protocol = 'galileosky' AND vendor_key = 'cmd.reply';
UPDATE tracker_protocol_params SET description = 'Which reply tag (0xe1 or 0xeb)'
  WHERE protocol = 'galileosky' AND vendor_key = 'cmd.reply_tag';

UPDATE tracker_protocol_params SET label = 'Command number', description = 'Tag 0xE0 uint32', value_type = 'number'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xe0';
UPDATE tracker_protocol_params SET description = 'Tag 0xE1 command/reply text'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xe1';
UPDATE tracker_protocol_params SET label = 'User data 0', description = 'Tag 0xE2 uint32', value_type = 'number'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xe2';
UPDATE tracker_protocol_params SET label = 'User data 1', description = 'Tag 0xE3 uint32', value_type = 'number'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xe3';
UPDATE tracker_protocol_params SET label = 'User data 2', description = 'Tag 0xE4 uint32', value_type = 'number'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xe4';
UPDATE tracker_protocol_params SET label = 'User data 3', description = 'Tag 0xE5 uint32', value_type = 'number'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xe5';
UPDATE tracker_protocol_params SET label = 'User data 4', description = 'Tag 0xE6 uint32', value_type = 'number'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xe6';

UPDATE tracker_protocol_params SET label = 'DS1923 0 temp', description = 'Tag 0x80 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x80';
UPDATE tracker_protocol_params SET label = 'DS1923 1 temp', description = 'Tag 0x81 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x81';
UPDATE tracker_protocol_params SET label = 'DS1923 2 temp', description = 'Tag 0x82 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x82';
UPDATE tracker_protocol_params SET label = 'DS1923 3 temp', description = 'Tag 0x83 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x83';
UPDATE tracker_protocol_params SET label = 'DS1923 4 temp', description = 'Tag 0x84 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x84';
UPDATE tracker_protocol_params SET label = 'DS1923 5 temp', description = 'Tag 0x85 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x85';
UPDATE tracker_protocol_params SET label = 'DS1923 6 temp', description = 'Tag 0x86 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x86';
UPDATE tracker_protocol_params SET label = 'DS1923 7 temp', description = 'Tag 0x87 DS1923 (not Modbus)'
  WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x87';
