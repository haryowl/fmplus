-- JT808 camera shoot (0x8801) and temporary track (0x8202) command types + voltage seeds.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8500', 'jt808_8801',
    'teltonika_codec12', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107', 'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'track'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'voltage.ext', 'External voltage (V)', 'number', 'AVL IO 66 mV→V'),
  ('teltonika', 'voltage.batt', 'Battery voltage (V)', 'number', 'AVL IO 67 mV→V'),
  ('teltonika', 'gsm.signal', 'GSM signal', 'number', 'AVL IO 21'),
  ('ruptela', 'voltage.ext', 'External voltage (V)', 'number', 'IO 66 mV→V'),
  ('ruptela', 'voltage.batt', 'Battery voltage (V)', 'number', 'IO 67 mV→V'),
  ('ruptela', 'records_left', 'Records left', 'number', 'FM records_left byte'),
  ('galileosky', 'hdop', 'HDOP', 'number', 'Tag 0x35 /10'),
  ('galileosky', 'voltage.ext', 'External voltage (V)', 'number', 'Tag 0x50 mV→V (common)'),
  ('jt808', 'drv_cmd', 'Driving record cmd', 'number', '0x0700 command byte')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
