-- Official Galileosky tag 0x21 is milliseconds of the unix second (2 bytes, 0–999),
-- not a user-data slot. Correct mistaken catalog from migration 163.
UPDATE tracker_protocol_params
SET label = 'Time milliseconds',
    value_type = 'number',
    description = 'Tag 0x21 uint16 LE: milliseconds of Tag 0x20 second (0–999)'
WHERE protocol = 'galileosky' AND vendor_key = 'tag.0x21';

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'time.ms', 'Time milliseconds', 'number', 'Tag 0x21: ms of unix second (0–999)'),
  ('galileosky', 'voltage.batt', 'Battery voltage V', 'number', 'Tag 0x42 mV/1000'),
  ('galileosky', 'voltage.ext', 'External/supply voltage V', 'number', 'Tag 0x41 mV/1000'),
  ('galileosky', 'heading.gps', 'GPS heading', 'number', 'Tag 0x33 high uint16/10'),
  ('galileosky', 'gnss.altitude', 'GNSS altitude m', 'number', 'Tag 0x34 int16'),
  ('galileosky', 'unix_time', 'Unix time', 'number', 'Tag 0x20 seconds since 1970 UTC'),
  ('galileosky', 'status.extended', 'Extended status', 'number', 'Tag 0x48 uint16'),
  ('galileosky', 'analog.0', 'Analog input 0 V', 'number', 'Tag 0x50 mV/1000'),
  ('galileosky', 'analog.1', 'Analog input 1 V', 'number', 'Tag 0x51 mV/1000'),
  ('galileosky', 'device.hw', 'Hardware version', 'number', 'Tag 0x01'),
  ('galileosky', 'device.fw', 'Firmware version', 'number', 'Tag 0x02'),
  ('galileosky', 'can.fuel_used', 'CAN fuel used L', 'number', 'Tag 0xC0 ÷ 2'),
  ('galileosky', 'can.fuel_level', 'CAN fuel level %', 'number', 'Tag 0xC1 byte0 × 0.4'),
  ('galileosky', 'can.coolant_temp', 'CAN coolant °C', 'number', 'Tag 0xC1 byte1 − 40'),
  ('galileosky', 'can.rpm', 'CAN engine RPM', 'number', 'Tag 0xC1 uint16 × 0.125'),
  ('galileosky', 'can.mileage', 'CAN mileage m', 'number', 'Tag 0xC2 × 5'),
  ('galileosky', 'engine.hours', 'Engine hours', 'number', 'Tag 0xDB ÷ 100'),
  ('galileosky', 'can.fuel_l', 'CAN fuel litres', 'number', 'Tag 0xDC ÷ 10'),
  ('galileosky', 'accel.x', 'Accel X g', 'number', 'Tag 0x44 (raw−512)/186'),
  ('galileosky', 'accel.y', 'Accel Y g', 'number', 'Tag 0x44 (raw−512)/186'),
  ('galileosky', 'accel.z', 'Accel Z g', 'number', 'Tag 0x44 (raw−512)/186')
ON CONFLICT (protocol, vendor_key) DO UPDATE SET
  label = EXCLUDED.label,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description;

-- Drop incorrect user.9↔0x21 mapping label if still present as a user slot.
UPDATE tracker_protocol_params
SET label = 'DEPRECATED wrong 0x21 user slot — use time.ms',
    description = 'Was wrongly mapped to Tag 0x21; official 0x21 is milliseconds. Prefer time.ms / tag.0x21.'
WHERE protocol = 'galileosky' AND vendor_key = 'user.9';
