-- Teltonika/Ruptela idling/geofence IO safety; JT808 gsm.signal + load; Galileo alt/speed; JT1078 pack mark.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'gsm.signal', 'GSM signal', 'number', 'TLV 0x30 alias'),
  ('jt808', 'vehicle.load', 'Vehicle load', 'string', 'Location status bits 8–9'),
  ('jt808', 'status.load_full', 'Load full', 'bool', 'Location status bits 8–9'),
  ('jt808', 'status.load_half', 'Load half', 'bool', 'Location status bits 8–9'),
  ('subiao', 'vehicle.load', 'Vehicle load', 'string', 'Inherited JT808 status'),
  ('jt809', 'status.oil_cut', 'Oil circuit cut', 'bool', '0x120x vehicle_state'),
  ('jt809', 'status.door1', 'Door 1 open', 'bool', '0x120x vehicle_state'),
  ('galileosky', 'gnss.altitude', 'Altitude', 'number', 'Tag 0x34'),
  ('galileosky', 'speed.gps', 'GPS speed', 'number', 'Tag 0x33'),
  ('galileosky', 'heading.gps', 'GPS heading', 'number', 'Tag 0x33'),
  ('jt1078', 'av_pack_mark', 'AV pack mark', 'string', 'Datatype high nibble')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
