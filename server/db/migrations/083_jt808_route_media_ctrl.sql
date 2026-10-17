-- JT808 route set/del (0x8606/8607), media upload control (0x8803); JT809/Teltonika keys.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8203', 'jt808_8204', 'jt808_8500',
    'jt808_8600', 'jt808_8601', 'jt808_8602', 'jt808_8603', 'jt808_8604', 'jt808_8605',
    'jt808_8606', 'jt808_8607', 'jt808_8608',
    'jt808_8801', 'jt808_8802', 'jt808_8803', 'jt808_8805', 'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'jt808_8301', 'jt808_8302', 'jt808_8303', 'jt808_8304', 'jt808_8900',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'multimedia_retrieve', 'multimedia_upload', 'multimedia_control', 'track',
    'driver_query', 'driving_record', 'link_detect', 'transparent',
    'geofence_del', 'geofence_set', 'geofence_query', 'route_set', 'route_del',
    'av_live', 'av_control', 'alarm_confirm',
    'event_set', 'question', 'info', 'info_menu'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt809', 'media_complete', 'Media upload complete', 'bool', '0x1602 notify'),
  ('teltonika', 'green_driving.value', 'Green driving value', 'number', 'AVL 253'),
  ('teltonika', 'green_driving.duration', 'Green driving duration', 'number', 'AVL 243'),
  ('teltonika', 'eco.score', 'Eco score', 'number', 'AVL 15 (config dependent)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
