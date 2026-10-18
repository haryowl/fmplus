-- Align JT/T 808/809 remaps with official JT/T 808—2019 / 809—2019 / 1078—2016 PDFs.
-- 808 Table 25 alarm bits; Table 31 0x25 signals; Table 32 0x2A sleep; 809 Tables 3–4 WARN_TYPE.

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'alarm.danger_driving', 'Dangerous driving', 'bool', '808-2019 Table 25 bit3'),
  ('jt808', 'alarm.gnss_module', 'GNSS module fault', 'bool', '808-2019 Table 25 bit4'),
  ('jt808', 'alarm.illegal_driving', 'Illegal driving', 'bool', '808-2019 Table 25 bit15'),
  ('jt808', 'alarm.tire_pressure_warn', 'Tire pressure warn', 'bool', '808-2019 Table 25 bit16'),
  ('jt808', 'alarm.right_blind_zone', 'Right blind-zone', 'bool', '808-2019 Table 25 bit17'),
  ('jt808', 'alarm.route_in_out', 'Route in/out', 'bool', '808-2019 Table 25 bit21'),
  ('jt808', 'alarm.route_drive_time', 'Route drive time', 'bool', '808-2019 Table 25 bit22'),
  ('jt808', 'alarm.route_deviation', 'Route deviation', 'bool', '808-2019 Table 25 bit23'),
  ('jt808', 'alarm.vss_fault', 'VSS fault', 'bool', '808-2019 Table 25 bit24'),
  ('jt808', 'alarm.rollover_warn', 'Rollover warn', 'bool', '808-2019 Table 25 bit30'),
  ('jt808', 'status.reverse', 'Reverse gear', 'bool', '808-2019 Table 31 bit5'),
  ('jt808', 'status.horn', 'Horn', 'bool', '808-2019 Table 31 bit8'),
  ('jt808', 'status.ac', 'Air conditioning', 'bool', '808-2019 Table 31 bit9'),
  ('jt808', 'status.neutral', 'Neutral', 'bool', '808-2019 Table 31 bit10'),
  ('jt808', 'status.retarder', 'Retarder', 'bool', '808-2019 Table 31 bit11'),
  ('jt808', 'status.abs', 'ABS working', 'bool', '808-2019 Table 31 bit12'),
  ('jt808', 'status.heater', 'Heater', 'bool', '808-2019 Table 31 bit13'),
  ('jt808', 'status.clutch', 'Clutch', 'bool', '808-2019 Table 31 bit14'),
  ('jt808', 'status.deep_sleep', 'Deep sleep', 'bool', '808-2019 Table 32 bit0'),
  ('jt808', 'status.sleep', 'Sleep', 'bool', '808-2019 Table 32 bit1'),
  ('jt808', 'status.fcw', 'FCW from status', 'bool', '808-2019 Table 24 bit6'),
  ('jt808', 'status.ldw', 'LDW from status', 'bool', '808-2019 Table 24 bit7'),
  ('jt808', 'status.moving', 'Vehicle moving', 'bool', '808-2019 Table 24 bit22'),
  ('jt808', 'analog.ad0', 'Analog AD0', 'number', '808-2019 TLV 0x2B bits0-15'),
  ('jt808', 'analog.ad1', 'Analog AD1', 'number', '808-2019 TLV 0x2B bits16-31'),
  ('jt808', 'tire.pressure', 'Tire pressure present', 'bool', '808-2019 TLV 0x05 30B'),
  ('jt809', 'alarm.fence_in', 'Enter area', 'bool', '809-2019 Table 3 0x0004'),
  ('jt809', 'alarm.fence_out', 'Leave area', 'bool', '809-2019 Table 3 0x0005'),
  ('jt809', 'alarm.border_cross', 'Border cross', 'bool', '809-2019 Table 3 0x0008'),
  ('jt809', 'alarm.hijack', 'Hijack', 'bool', '809-2019 Table 3 0x000A'),
  ('jt809', 'alarm.lane_departure', 'Lane departure', 'bool', '809-2019 Table 3 0x0012'),
  ('jt809', 'alarm.parking_timeout', 'Overtime parking', 'bool', '809-2019 Table 4 0xA001')
ON CONFLICT (protocol, vendor_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

-- Correct descriptions for remapped bits / signals.
UPDATE tracker_protocol_params SET description = '808-2019 Table 25 bit18 (was wrongly bit16)'
  WHERE protocol IN ('jt808', 'subiao') AND vendor_key = 'alarm.day_drive_timeout';
UPDATE tracker_protocol_params SET description = '808-2019 Table 25 bit19'
  WHERE protocol IN ('jt808', 'subiao') AND vendor_key = 'alarm.parking_timeout';
UPDATE tracker_protocol_params SET description = '808-2019 Table 31 bit0 (near beam; was wrongly ACC)'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.low_beam';
UPDATE tracker_protocol_params SET description = '808-2019 Table 31 bit1'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.high_beam';
UPDATE tracker_protocol_params SET description = '808-2019 Table 31 bit2'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.right_turn';
UPDATE tracker_protocol_params SET description = '808-2019 Table 31 bit3'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.left_turn';
UPDATE tracker_protocol_params SET description = '808-2019 Table 31 bit4'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.brake';
UPDATE tracker_protocol_params SET description = '808-2019 Table 31 bit6'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.fog';
UPDATE tracker_protocol_params SET description = '808-2019 Table 31 bit7'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.position_lamp';
UPDATE tracker_protocol_params SET description = 'Deprecated: 0x25 is not ACC (use location status bit0)'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key = 'status.acc'
    AND description LIKE '%0x25%';
UPDATE tracker_protocol_params SET description = 'Deprecated invent: not in 808-2019 Table 31'
  WHERE protocol IN ('jt808', 'subiao', 'jt809') AND vendor_key IN ('status.wiper', 'status.card_reader');

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('subiao', 'alarm.danger_driving', 'Dangerous driving', 'bool', 'Inherited JT808 808-2019 bit3'),
  ('subiao', 'alarm.tire_pressure_warn', 'Tire pressure warn', 'bool', 'Inherited JT808 808-2019 bit16'),
  ('subiao', 'status.reverse', 'Reverse gear', 'bool', 'Inherited JT808 Table 31'),
  ('subiao', 'status.deep_sleep', 'Deep sleep', 'bool', 'Inherited JT808 Table 32'),
  ('subiao', 'status.sleep', 'Sleep', 'bool', 'Inherited JT808 Table 32')
ON CONFLICT (protocol, vendor_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;
