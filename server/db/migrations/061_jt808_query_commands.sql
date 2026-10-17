-- JT808 query downlinks: 0x8104 (params) and 0x8107 (terminal attributes).
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8104', 'jt808_8107', 'jt808_8500',
    'teltonika_codec12', 'concox_gprs', 'ruptela_sms', 'galileosky_text',
    'param', 'control', 'vehicle_control'
  ));
