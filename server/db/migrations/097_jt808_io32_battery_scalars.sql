-- JT808 TLV 0x2A/0x2B; Teltonika/Ruptela battery scalars; Galileosky unix_time.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'io.status32', 'IO status DWORD', 'number', 'TLV 0x2A'),
  ('jt808', 'status.dout1', 'DOUT1', 'bool', 'TLV 0x2A'),
  ('jt808', 'status.dout2', 'DOUT2', 'bool', 'TLV 0x2A'),
  ('jt808', 'analog.ad2', 'Analog AD2', 'number', 'TLV 0x2B /100'),
  ('teltonika', 'battery.level', 'Battery level %', 'number', 'AVL 113'),
  ('teltonika', 'battery.voltage', 'Battery voltage', 'number', 'AVL 114 mV→V'),
  ('ruptela', 'battery.level', 'Battery level %', 'number', 'IO 113'),
  ('ruptela', 'battery.voltage', 'Battery voltage', 'number', 'IO 114 mV→V'),
  ('galileosky', 'unix_time', 'Unix time', 'number', 'Tag 0x20')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
