-- JT808 stored multimedia retrieve (0x8802 / 0x0802) + JT809/Teltonika status keys.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8105', 'jt808_8107', 'jt808_8201', 'jt808_8202',
    'jt808_8203', 'jt808_8204', 'jt808_8500', 'jt808_8600', 'jt808_8601', 'jt808_8608', 'jt808_8801', 'jt808_8802',
    'jt808_8700', 'jt808_8702', 'jt808_9101', 'jt808_9102',
    'teltonika_codec12', 'teltonika_codec14', 'concox_gprs', 'ruptela_sms', 'ruptela_105', 'ruptela_107',
    'galileosky_text',
    'param', 'control', 'vehicle_control', 'query_params', 'query_attrs', 'query_location', 'terminal_control',
    'config', 'camera', 'multimedia_retrieve', 'track', 'driver_query', 'driving_record', 'link_detect',
    'geofence_del', 'geofence_set', 'geofence_query', 'av_live', 'av_control', 'alarm_confirm'
  ));

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'media_count', 'Media item count', 'number', '0x0802 retrieval response count'),
  ('jt808', 'media_retrieve_hex', 'Media retrieve snip', 'string', '0x0802 body hex snippet'),
  ('jt809', 'platform_id', 'Platform ID', 'string', '0x1201 registration'),
  ('jt809', 'producer_id', 'Producer ID', 'string', '0x1201 registration'),
  ('jt809', 'terminal_model', 'Terminal model', 'string', '0x1201 registration'),
  ('jt809', 'terminal_id', 'Terminal ID', 'string', '0x1201 registration'),
  ('jt809', 'terminal_sim', 'Terminal SIM', 'string', '0x1201 registration'),
  ('teltonika', 'alarm.crash', 'Crash (IO)', 'bool', 'AVL 247 present on periodic record'),
  ('teltonika', 'alarm.towing', 'Towing (IO)', 'bool', 'AVL 246 present on periodic record'),
  ('teltonika', 'alarm.jamming', 'Jamming (IO)', 'bool', 'AVL 249 present on periodic record')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
