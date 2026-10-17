-- JT808 event set (0x8301) / question (0x8302) + Galileosky fuel/user tag keys.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8203', 'jt808_8204', 'jt808_8500', 'jt808_8600', 'jt808_8601', 'jt808_8602', 'jt808_8608',
    'jt808_8801', 'jt808_8802', 'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'jt808_8301', 'jt808_8302',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'multimedia_retrieve', 'track', 'driver_query', 'driving_record', 'link_detect',
    'geofence_del', 'geofence_set', 'geofence_query', 'av_live', 'av_control', 'alarm_confirm',
    'event_set', 'question'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'answer_id', 'Question answer id', 'number', '0x0302 answer'),
  ('jt808', 'answer_text', 'Question answer text', 'string', '0x0302 optional content'),
  ('galileosky', 'fuel.level', 'Fuel level', 'number', 'Tag 0x60 (model units)'),
  ('galileosky', 'fuel.level2', 'Fuel level 2', 'number', 'Tag 0x61'),
  ('galileosky', 'fuel.temp', 'Fuel temp', 'number', 'Tag 0x62'),
  ('galileosky', 'fuel.freq', 'Fuel freq', 'number', 'Tag 0x63'),
  ('galileosky', 'user.0', 'User status 0', 'number', 'Tag 0x11'),
  ('galileosky', 'analog.2', 'Analog 2', 'number', 'Tag 0x52 V')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
