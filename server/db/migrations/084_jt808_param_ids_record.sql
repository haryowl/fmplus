-- JT808 query designated params (0x8106) and audio record (0x8804); sensor/status keys.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8106', 'jt808_8107',
    'jt808_8201', 'jt808_8202', 'jt808_8203', 'jt808_8204', 'jt808_8500',
    'jt808_8600', 'jt808_8601', 'jt808_8602', 'jt808_8603', 'jt808_8604', 'jt808_8605',
    'jt808_8606', 'jt808_8607', 'jt808_8608',
    'jt808_8801', 'jt808_8802', 'jt808_8803', 'jt808_8804', 'jt808_8805',
    'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'jt808_8301', 'jt808_8302', 'jt808_8303', 'jt808_8304', 'jt808_8900',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_param_ids', 'query_attrs', 'query_location',
    'terminal_control', 'config', 'camera', 'multimedia_retrieve', 'multimedia_upload', 'multimedia_control',
    'record_audio', 'track', 'driver_query', 'driving_record', 'link_detect', 'transparent',
    'geofence_del', 'geofence_set', 'geofence_query', 'route_set', 'route_del',
    'av_live', 'av_control', 'alarm_confirm',
    'event_set', 'question', 'info', 'info_menu'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt809', 'vehicle_online', 'Vehicle online', 'bool', '0x1205/0x1206'),
  ('jt1078', 'av_seq', 'AV sequence', 'number', 'Header bytes 14–15'),
  ('galileosky', 'device.hw', 'Hardware version', 'number', 'Tag 0x01'),
  ('galileosky', 'device.fw', 'Firmware version', 'number', 'Tag 0x02'),
  ('teltonika', 'accel.x', 'Accel X', 'number', 'AVL 17'),
  ('teltonika', 'accel.y', 'Accel Y', 'number', 'AVL 18'),
  ('teltonika', 'accel.z', 'Accel Z', 'number', 'AVL 19')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
