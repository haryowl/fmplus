-- Galileosky DIN/DOUT bits; Teltonika/Ruptela GSM operator; JT808 CAN/drv names; JT1078 timestamp.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'status.din0', 'Digital in 0', 'bool', 'Tag 0x46 bit0'),
  ('galileosky', 'status.dout0', 'Digital out 0', 'bool', 'Tag 0x47 bit0'),
  ('galileosky', 'status.ignition', 'Ignition', 'bool', 'Tag 0x46 bit0'),
  ('teltonika', 'gsm.operator', 'GSM operator', 'number', 'AVL 241'),
  ('teltonika', 'gsm.iccid', 'ICCID hint', 'string', 'AVL 11'),
  ('ruptela', 'gsm.operator', 'GSM operator', 'number', 'IO 241'),
  ('jt808', 'drv_cmd_name', 'Driving record cmd', 'string', '0x0700'),
  ('jt808', 'can.first_id', 'First CAN id', 'number', '0x0705'),
  ('jt808', 'can.0.data0', 'CAN byte0', 'number', '0x0705'),
  ('jt1078', 'av_timestamp', 'AV timestamp', 'number', 'Payload after SSRC'),
  ('jt1078', 'av_data_kind', 'AV data kind', 'string', 'Header type nibble')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
