-- JT808 short-frame; Galileosky sync_skip; Ruptela unknown cmd honesty.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'frame_short', 'Frame too short', 'bool', 'Unescaped frame under 13 bytes'),
  ('subiao', 'frame_short', 'Frame too short', 'bool', 'Inherited JT808'),
  ('galileosky', 'sync_skip', 'Sync skip', 'bool', 'Header byte not 0x01'),
  ('galileosky', 'hdr0', 'Header byte 0', 'number', 'Unexpected first header byte'),
  ('ruptela', 'cmd_unmapped', 'Command unmapped', 'bool', 'Unknown uplink cmd byte'),
  ('ruptela', 'cmd', 'Command byte', 'number', 'Raw uplink command id')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
