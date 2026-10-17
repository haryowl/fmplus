-- JT808 set circular geofence (0x8600) and manual alarm confirm (0x8203).
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8203', 'jt808_8204', 'jt808_8500', 'jt808_8600', 'jt808_8601', 'jt808_8608', 'jt808_8801',
    'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'track', 'driver_query', 'driving_record', 'link_detect', 'geofence_del', 'geofence_set',
    'geofence_query', 'av_live', 'av_control', 'alarm_confirm'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'alarm.battery_low', 'Battery low', 'bool', 'Tag 0x44 bit1 (heuristic)'),
  ('galileosky', 'alarm.gsm_jamming', 'GSM jamming', 'bool', 'Tag 0x45 bit0 (heuristic)'),
  ('teltonika', 'alarm.door', 'Door', 'bool', 'DIN/door event IO'),
  ('jt809', 'media_type', 'Media type', 'number', '0x1601 experimental'),
  ('jt808', 'alarm.door_abnormal', 'Door abnormal', 'bool', 'Location alarm bit22')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
