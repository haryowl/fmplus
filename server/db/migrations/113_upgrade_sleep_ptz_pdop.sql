-- JT808 upgrade_ok/kind; Teltonika/Ruptela sleep/idling status; JT1078 PTZ; Galileosky PDOP.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'upgrade_ok', 'Upgrade ok', 'bool', '0x0108 result=0'),
  ('jt808', 'upgrade_kind', 'Upgrade kind', 'string', '0x0108 type class'),
  ('teltonika', 'status.sleeping', 'Sleeping', 'bool', 'AVL 200 nonzero'),
  ('teltonika', 'status.idling', 'Idling', 'bool', 'AVL 251'),
  ('ruptela', 'status.sleeping', 'Sleeping', 'bool', 'IO 200 nonzero'),
  ('ruptela', 'status.idling', 'Idling', 'bool', 'IO 251'),
  ('jt1078', 'av_ptz_speed', 'PTZ speed', 'number', 'Passthrough payload[2]'),
  ('jt1078', 'av_ptz_param', 'PTZ param', 'number', 'Passthrough payload[3]'),
  ('galileosky', 'gnss.pdop', 'GNSS PDOP', 'number', 'Tag 0x36')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
