-- Expand downlink command_type values for JT808 param/control and Teltonika Codec12.
ALTER TABLE tracker_commands DROP CONSTRAINT IF EXISTS tracker_commands_command_type_check;
ALTER TABLE tracker_commands
  ADD CONSTRAINT tracker_commands_command_type_check CHECK (command_type IN (
    'raw', 'text', 'jt808', 'jt808_8103', 'jt808_8500',
    'teltonika_codec12', 'param', 'control', 'vehicle_control'
  ));
