-- JT808 rectangular geofence (0x8602) + JT1078/Ruptela status keys.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8203', 'jt808_8204', 'jt808_8500', 'jt808_8600', 'jt808_8601', 'jt808_8602', 'jt808_8608',
    'jt808_8801', 'jt808_8802', 'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'multimedia_retrieve', 'track', 'driver_query', 'driving_record', 'link_detect',
    'geofence_del', 'geofence_set', 'geofence_query', 'av_live', 'av_control', 'alarm_confirm'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'geofence.id', 'Geofence area id', 'number', '0x0608 first area id'),
  ('jt808', 'geofence.lat', 'Geofence center lat', 'number', '0x0608 circle'),
  ('jt808', 'geofence.lon', 'Geofence center lon', 'number', '0x0608 circle'),
  ('jt808', 'geofence.radius', 'Geofence radius m', 'number', '0x0608 circle'),
  ('jt808', 'geofence.lat1', 'Geofence NW lat', 'number', '0x0608 rectangle'),
  ('jt808', 'geofence.lon1', 'Geofence NW lon', 'number', '0x0608 rectangle'),
  ('jt808', 'geofence.lat2', 'Geofence SE lat', 'number', '0x0608 rectangle'),
  ('jt808', 'geofence.lon2', 'Geofence SE lon', 'number', '0x0608 rectangle'),
  ('jt1078', 'av_ssrc', 'AV SSRC hint', 'number', 'Experimental signaling payload'),
  ('jt1078', 'av_ptz_cmd', 'AV PTZ command', 'number', 'Passthrough signaling'),
  ('jt1078', 'av_stream', 'AV stream control', 'number', 'Passthrough signaling'),
  ('ruptela', 'ident.fw', 'Firmware', 'string', 'Cmd 3 identification'),
  ('ruptela', 'ident.hw', 'Hardware', 'string', 'Cmd 3 identification'),
  ('ruptela', 'ident.cfg', 'Config', 'string', 'Cmd 3 identification'),
  ('ruptela', 'alarm.sos', 'SOS', 'bool', 'DIN/SOS event IO'),
  ('ruptela', 'alarm.door', 'Door', 'bool', 'DIN/door event IO')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
