-- JT808 driver identity request (0x8702), driving-record collect (0x8700), link detect (0x8204).
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8204', 'jt808_8500', 'jt808_8801', 'jt808_8700', 'jt808_8702',
    'teltonika_codec12', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107', 'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'track', 'driver_query', 'driving_record', 'link_detect'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'status.outputs', 'Output status', 'number', 'Tag 0x47'),
  ('galileosky', 'output.0', 'Output 0', 'bool', 'Tag 0x47 bit0'),
  ('galileosky', 'status.inputs', 'Input status lo', 'number', 'Tag 0x46'),
  ('jt808', 'first_packet_id', 'Subpkg retransmit first id', 'number', '0x0005'),
  ('jt809', 'vehicle_plate', 'Vehicle plate', 'string', '0x1200/0x1201')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
