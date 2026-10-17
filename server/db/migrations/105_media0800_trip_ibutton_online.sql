-- JT808 0x0800 location + shoot_ok; Teltonika trip/overspeed; Ruptela iButton; JT809 online time.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'media_has_location', 'Media has location', 'bool', '0x0800/0x0801'),
  ('jt808', 'shoot_ok', 'Camera shoot ok', 'bool', '0x0805 result=0'),
  ('jt808', 'media_id', 'Media id', 'number', '0x0805 first id'),
  ('teltonika', 'trip.distance', 'Trip distance', 'number', 'AVL 250'),
  ('teltonika', 'overspeed.threshold', 'Overspeed threshold', 'number', 'AVL 255'),
  ('ruptela', 'ibutton.id', 'iButton id', 'string', 'IO 78'),
  ('jt809', 'online_time', 'Online/offline time', 'string', '0x1205/0x1206'),
  ('jt809', 'online_time_bcd', 'Online time BCD', 'string', '0x1205/0x1206')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
