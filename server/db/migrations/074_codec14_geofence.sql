-- Teltonika Codec14 + JT808 delete circular geofence (0x8601).
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8204', 'jt808_8500', 'jt808_8601', 'jt808_8801', 'jt808_8700', 'jt808_8702',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'track', 'driver_query', 'driving_record', 'link_detect', 'geofence_del'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'province_id', 'Province ID', 'number', '0x0100 register'),
  ('jt808', 'city_id', 'City ID', 'number', '0x0100 register'),
  ('jt808', 'vehicle_plate', 'Vehicle plate', 'string', '0x0100 register'),
  ('jt808', 'area_query_type', 'Area query type', 'number', '0x0608'),
  ('ruptela', 'fuel.level', 'Fuel level', 'number', 'IO 89'),
  ('ruptela', 'temp.1', 'Temperature 1', 'number', 'IO 72')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
