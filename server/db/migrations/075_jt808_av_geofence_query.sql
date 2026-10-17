-- JT808 area query (0x8608), realtime AV (0x9101/0x9102), and related seeds.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8204', 'jt808_8500', 'jt808_8601', 'jt808_8608', 'jt808_8801', 'jt808_8700', 'jt808_8702',
    'jt808_9101', 'jt808_9102',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'track', 'driver_query', 'driving_record', 'link_detect', 'geofence_del', 'geofence_query',
    'av_live', 'av_control'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'auth_code', 'Auth code', 'string', '0x0102'),
  ('jt1078', 'av_kind', 'AV frame kind', 'string', 'video_i/p/b|audio|passthrough'),
  ('galileosky', 'voltage.batt', 'Battery voltage (V)', 'number', 'Tag 0x51 mV→V (common)'),
  ('teltonika', 'voltage.ain1', 'Analog input 1 (V)', 'number', 'AVL IO 9 mV→V'),
  ('teltonika', 'sleep.mode', 'Sleep mode', 'number', 'AVL IO 200'),
  ('teltonika', 'idling', 'Idling', 'bool', 'AVL IO 251')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
