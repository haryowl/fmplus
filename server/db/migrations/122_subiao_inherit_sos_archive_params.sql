-- Subiao inherit (110–114 lag); Teltonika alarm.sos; Galileosky archive flags; JT808 alarm mask + ADAS/DSM catalog.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('subiao', 'device.iccid', 'ICCID', 'string', 'Inherited JT808 0x0107'),
  ('subiao', 'device.hw_ver', 'Hardware version', 'string', 'Inherited JT808 0x0107'),
  ('subiao', 'device.fw_ver', 'Firmware version', 'string', 'Inherited JT808 0x0107'),
  ('subiao', 'media_has_location', 'Media has location', 'bool', 'Inherited JT808 0x0801'),
  ('subiao', 'gnss.sats', 'GNSS satellites', 'number', 'Inherited JT808 TLV 0x31'),
  ('subiao', 'gsm.signal', 'GSM signal', 'number', 'Inherited JT808 TLV 0x30'),
  ('teltonika', 'alarm.sos', 'SOS', 'bool', 'AVL event IO 1 or 9'),
  ('galileosky', 'archive', 'Archive packet', 'bool', 'Length high bit on 0x01 frame'),
  ('galileosky', 'record_count', 'Records in packet', 'number', 'Multi-record 0x01'),
  ('jt808', 'alarm.mask', 'Alarm mask', 'number', 'Terminal param 0x0050'),
  ('jt808', 'alarm.sms_switch', 'Alarm SMS switch', 'number', 'Terminal param 0x0051'),
  ('subiao', 'alarm.mask', 'Alarm mask', 'number', 'Inherited JT808 0x0050'),
  ('subiao', 'alarm.sms_switch', 'Alarm SMS switch', 'number', 'Inherited JT808 0x0051'),
  ('jt808', 'adas.ldw', 'LDW', 'bool', 'Su Biao ADAS on location'),
  ('jt808', 'adas.pcw', 'PCW', 'bool', 'Su Biao ADAS on location'),
  ('jt808', 'adas.close', 'Close vehicle', 'bool', 'Su Biao ADAS on location'),
  ('jt808', 'dsm.phone', 'Phone', 'bool', 'Su Biao DSM on location'),
  ('jt808', 'dsm.smoke', 'Smoke', 'bool', 'Su Biao DSM on location'),
  ('jt808', 'dsm.distract', 'Distract', 'bool', 'Su Biao DSM on location')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
