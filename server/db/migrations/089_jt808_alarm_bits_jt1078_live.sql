-- Expand JT808 alarm dword remaps + JT1078 live-stream status keys.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'alarm.camera_fault', 'Camera fault', 'bool', 'Alarm bit 11'),
  ('jt808', 'alarm.road_ic', 'Road IC module', 'bool', 'Alarm bit 12'),
  ('jt808', 'alarm.overspeed_warn', 'Overspeed warning', 'bool', 'Alarm bit 13'),
  ('jt808', 'alarm.fatigue_warn', 'Fatigue warning', 'bool', 'Alarm bit 14'),
  ('jt808', 'alarm.day_drive_timeout', 'Day drive overtime', 'bool', 'Alarm bit 16'),
  ('jt808', 'alarm.parking_timeout', 'Parking timeout', 'bool', 'Alarm bit 17'),
  ('jt808', 'alarm.fuel_abnormal', 'Fuel abnormal', 'bool', 'Alarm bit 23'),
  ('jt808', 'alarm.theft', 'Vehicle theft', 'bool', 'Alarm bit 24'),
  ('jt1078', 'av_live', 'AV live stream', 'bool', 'Video/audio datatype hint after 0x9101'),
  ('jt1078', 'av_channel', 'AV channel', 'number', 'Header channel byte'),
  ('jt1078', 'av_datatype', 'AV datatype', 'number', 'Header datatype byte')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
