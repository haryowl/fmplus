-- Teltonika/Ruptela fuel.volume AVL84; JT808 driver.ic_time/can_time + GNSS params 0x0090-94; Galileosky 0x41 status.ignition.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'fuel.volume', 'Fuel volume', 'number', 'AVL IO 84'),
  ('ruptela', 'fuel.volume', 'Fuel volume', 'number', 'IO 84 (Teltonika-parity)'),
  ('jt808', 'driver.ic_time', 'Driver IC time', 'string', '0x0702 / TLV 0x32 RFC3339'),
  ('jt808', 'can_time', 'CAN bus time', 'string', '0x0705 YYMMDDhhmm RFC3339'),
  ('jt808', 'gnss.mode', 'GNSS mode', 'number', 'Terminal param 0x0090'),
  ('jt808', 'gnss.baud', 'GNSS baud', 'number', 'Terminal param 0x0091'),
  ('jt808', 'gnss.nmea_out', 'NMEA output', 'number', 'Terminal param 0x0092'),
  ('jt808', 'gnss.nmea_collect_freq', 'NMEA collect freq', 'number', 'Terminal param 0x0093'),
  ('jt808', 'gnss.nmea_collect', 'NMEA collect set', 'number', 'Terminal param 0x0094'),
  ('subiao', 'driver.ic_time', 'Driver IC time', 'string', 'Inherited JT808'),
  ('subiao', 'can_time', 'CAN bus time', 'string', 'Inherited JT808 0x0705'),
  ('subiao', 'gnss.mode', 'GNSS mode', 'number', 'Inherited JT808 0x0090'),
  ('subiao', 'gnss.baud', 'GNSS baud', 'number', 'Inherited JT808 0x0091'),
  ('subiao', 'gnss.nmea_out', 'NMEA output', 'number', 'Inherited JT808 0x0092'),
  ('subiao', 'gnss.nmea_collect_freq', 'NMEA collect freq', 'number', 'Inherited JT808 0x0093'),
  ('subiao', 'gnss.nmea_collect', 'NMEA collect set', 'number', 'Inherited JT808 0x0094'),
  ('galileosky', 'status.ignition', 'Ignition', 'bool', 'Tag 0x41 bit0 (also status.acc)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
