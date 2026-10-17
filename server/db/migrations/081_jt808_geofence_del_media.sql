-- JT808 geofence delete rect/poly, media-by-id, transparent DL; Teltonika BLE keys.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8203', 'jt808_8204', 'jt808_8500',
    'jt808_8600', 'jt808_8601', 'jt808_8602', 'jt808_8603', 'jt808_8604', 'jt808_8605', 'jt808_8608',
    'jt808_8801', 'jt808_8802', 'jt808_8805', 'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'jt808_8301', 'jt808_8302', 'jt808_8304', 'jt808_8900',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'multimedia_retrieve', 'multimedia_upload', 'track', 'driver_query', 'driving_record',
    'link_detect', 'transparent',
    'geofence_del', 'geofence_set', 'geofence_query', 'av_live', 'av_control', 'alarm_confirm',
    'event_set', 'question', 'info'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'ble.temp1', 'BLE temp 1', 'number', 'AVL 25 (°C×10)'),
  ('teltonika', 'ble.temp2', 'BLE temp 2', 'number', 'AVL 26'),
  ('teltonika', 'ble.humidity', 'BLE humidity', 'number', 'AVL 29'),
  ('teltonika', 'ble.battery', 'BLE battery', 'number', 'AVL 86'),
  ('jt809', 'proto_msg', '809 message id', 'string', 'Includes 0x1203 history location')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
