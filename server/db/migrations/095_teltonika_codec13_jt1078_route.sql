-- Teltonika Codec13 command type; JT1078 av_sim; JT808 0x0608 route query keys.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8106', 'jt808_8107', 'jt808_8108',
    'jt808_8201', 'jt808_8202', 'jt808_8203', 'jt808_8204', 'jt808_8500',
    'jt808_8600', 'jt808_8601', 'jt808_8602', 'jt808_8603', 'jt808_8604', 'jt808_8605',
    'jt808_8606', 'jt808_8607', 'jt808_8608',
    'jt808_8801', 'jt808_8802', 'jt808_8803', 'jt808_8804', 'jt808_8805',
    'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'jt808_8301', 'jt808_8302', 'jt808_8303', 'jt808_8304', 'jt808_8400', 'jt808_8401', 'jt808_8900',
    'teltonika_codec12', 'teltonika_codec13', 'teltonika_codec14', 'concox_gprs',
    'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_param_ids', 'query_attrs', 'query_location',
    'terminal_control', 'terminal_upgrade', 'config', 'camera', 'multimedia_retrieve', 'multimedia_upload',
    'multimedia_control', 'record_audio', 'track', 'driver_query', 'driving_record', 'link_detect', 'transparent',
    'geofence_del', 'geofence_set', 'geofence_query', 'route_set', 'route_del',
    'av_live', 'av_control', 'alarm_confirm',
    'event_set', 'question', 'info', 'info_menu', 'phone_callback', 'phonebook'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt1078', 'av_sim', 'AV SIM / phone', 'string', 'BCD or ASCII SIM from signaling'),
  ('jt808', 'route.width', 'Route width', 'number', '0x0608 type=4'),
  ('jt808', 'route.point_count', 'Route point count', 'number', '0x0608 type=4'),
  ('jt808', 'route.lat', 'Route first lat', 'number', '0x0608 type=4'),
  ('jt808', 'route.lon', 'Route first lon', 'number', '0x0608 type=4')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
