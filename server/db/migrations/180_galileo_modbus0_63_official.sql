-- Official Galileosky Modbus0–63 (extended tags inside 0xFE).
-- Outer tag 0xFE: 2-byte LE length + nested records of 6 bytes each:
--   ext_id uint16 LE (2) + value int32 LE (4).
-- Modbus0–31 = FE ext 0x01–0x20; Modbus32–63 = FE ext 0x61–0x80.
-- Main-table tags 0x80–0x87 are DS1923 (3 bytes), NOT Modbus.
-- Drop obsolete modbus.*_hi rows (wrong 8-byte 0x80–87 interpretation).

DELETE FROM tracker_protocol_params
  WHERE protocol = 'galileosky' AND vendor_key LIKE 'modbus.%_hi';

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'modbus.0', 'Modbus 0', 'number', 'Official Modbus0: FE ext 0x01; 4-byte signed LE int32'),
  ('galileosky', 'modbus.1', 'Modbus 1', 'number', 'Official Modbus1: FE ext 0x02; 4-byte signed LE int32'),
  ('galileosky', 'modbus.2', 'Modbus 2', 'number', 'Official Modbus2: FE ext 0x03; 4-byte signed LE int32'),
  ('galileosky', 'modbus.3', 'Modbus 3', 'number', 'Official Modbus3: FE ext 0x04; 4-byte signed LE int32'),
  ('galileosky', 'modbus.4', 'Modbus 4', 'number', 'Official Modbus4: FE ext 0x05; 4-byte signed LE int32'),
  ('galileosky', 'modbus.5', 'Modbus 5', 'number', 'Official Modbus5: FE ext 0x06; 4-byte signed LE int32'),
  ('galileosky', 'modbus.6', 'Modbus 6', 'number', 'Official Modbus6: FE ext 0x07; 4-byte signed LE int32'),
  ('galileosky', 'modbus.7', 'Modbus 7', 'number', 'Official Modbus7: FE ext 0x08; 4-byte signed LE int32'),
  ('galileosky', 'modbus.8', 'Modbus 8', 'number', 'Official Modbus8: FE ext 0x09; 4-byte signed LE int32'),
  ('galileosky', 'modbus.9', 'Modbus 9', 'number', 'Official Modbus9: FE ext 0x0A; 4-byte signed LE int32'),
  ('galileosky', 'modbus.10', 'Modbus 10', 'number', 'Official Modbus10: FE ext 0x0B; 4-byte signed LE int32'),
  ('galileosky', 'modbus.11', 'Modbus 11', 'number', 'Official Modbus11: FE ext 0x0C; 4-byte signed LE int32'),
  ('galileosky', 'modbus.12', 'Modbus 12', 'number', 'Official Modbus12: FE ext 0x0D; 4-byte signed LE int32'),
  ('galileosky', 'modbus.13', 'Modbus 13', 'number', 'Official Modbus13: FE ext 0x0E; 4-byte signed LE int32'),
  ('galileosky', 'modbus.14', 'Modbus 14', 'number', 'Official Modbus14: FE ext 0x0F; 4-byte signed LE int32'),
  ('galileosky', 'modbus.15', 'Modbus 15', 'number', 'Official Modbus15: FE ext 0x10; 4-byte signed LE int32'),
  ('galileosky', 'modbus.16', 'Modbus 16', 'number', 'Official Modbus16: FE ext 0x11; 4-byte signed LE int32'),
  ('galileosky', 'modbus.17', 'Modbus 17', 'number', 'Official Modbus17: FE ext 0x12; 4-byte signed LE int32'),
  ('galileosky', 'modbus.18', 'Modbus 18', 'number', 'Official Modbus18: FE ext 0x13; 4-byte signed LE int32'),
  ('galileosky', 'modbus.19', 'Modbus 19', 'number', 'Official Modbus19: FE ext 0x14; 4-byte signed LE int32'),
  ('galileosky', 'modbus.20', 'Modbus 20', 'number', 'Official Modbus20: FE ext 0x15; 4-byte signed LE int32'),
  ('galileosky', 'modbus.21', 'Modbus 21', 'number', 'Official Modbus21: FE ext 0x16; 4-byte signed LE int32'),
  ('galileosky', 'modbus.22', 'Modbus 22', 'number', 'Official Modbus22: FE ext 0x17; 4-byte signed LE int32'),
  ('galileosky', 'modbus.23', 'Modbus 23', 'number', 'Official Modbus23: FE ext 0x18; 4-byte signed LE int32'),
  ('galileosky', 'modbus.24', 'Modbus 24', 'number', 'Official Modbus24: FE ext 0x19; 4-byte signed LE int32'),
  ('galileosky', 'modbus.25', 'Modbus 25', 'number', 'Official Modbus25: FE ext 0x1A; 4-byte signed LE int32'),
  ('galileosky', 'modbus.26', 'Modbus 26', 'number', 'Official Modbus26: FE ext 0x1B; 4-byte signed LE int32'),
  ('galileosky', 'modbus.27', 'Modbus 27', 'number', 'Official Modbus27: FE ext 0x1C; 4-byte signed LE int32'),
  ('galileosky', 'modbus.28', 'Modbus 28', 'number', 'Official Modbus28: FE ext 0x1D; 4-byte signed LE int32'),
  ('galileosky', 'modbus.29', 'Modbus 29', 'number', 'Official Modbus29: FE ext 0x1E; 4-byte signed LE int32'),
  ('galileosky', 'modbus.30', 'Modbus 30', 'number', 'Official Modbus30: FE ext 0x1F; 4-byte signed LE int32'),
  ('galileosky', 'modbus.31', 'Modbus 31', 'number', 'Official Modbus31: FE ext 0x20; 4-byte signed LE int32'),
  ('galileosky', 'modbus.32', 'Modbus 32', 'number', 'Official Modbus32: FE ext 0x61; 4-byte signed LE int32'),
  ('galileosky', 'modbus.33', 'Modbus 33', 'number', 'Official Modbus33: FE ext 0x62; 4-byte signed LE int32'),
  ('galileosky', 'modbus.34', 'Modbus 34', 'number', 'Official Modbus34: FE ext 0x63; 4-byte signed LE int32'),
  ('galileosky', 'modbus.35', 'Modbus 35', 'number', 'Official Modbus35: FE ext 0x64; 4-byte signed LE int32'),
  ('galileosky', 'modbus.36', 'Modbus 36', 'number', 'Official Modbus36: FE ext 0x65; 4-byte signed LE int32'),
  ('galileosky', 'modbus.37', 'Modbus 37', 'number', 'Official Modbus37: FE ext 0x66; 4-byte signed LE int32'),
  ('galileosky', 'modbus.38', 'Modbus 38', 'number', 'Official Modbus38: FE ext 0x67; 4-byte signed LE int32'),
  ('galileosky', 'modbus.39', 'Modbus 39', 'number', 'Official Modbus39: FE ext 0x68; 4-byte signed LE int32'),
  ('galileosky', 'modbus.40', 'Modbus 40', 'number', 'Official Modbus40: FE ext 0x69; 4-byte signed LE int32'),
  ('galileosky', 'modbus.41', 'Modbus 41', 'number', 'Official Modbus41: FE ext 0x6A; 4-byte signed LE int32'),
  ('galileosky', 'modbus.42', 'Modbus 42', 'number', 'Official Modbus42: FE ext 0x6B; 4-byte signed LE int32'),
  ('galileosky', 'modbus.43', 'Modbus 43', 'number', 'Official Modbus43: FE ext 0x6C; 4-byte signed LE int32'),
  ('galileosky', 'modbus.44', 'Modbus 44', 'number', 'Official Modbus44: FE ext 0x6D; 4-byte signed LE int32'),
  ('galileosky', 'modbus.45', 'Modbus 45', 'number', 'Official Modbus45: FE ext 0x6E; 4-byte signed LE int32'),
  ('galileosky', 'modbus.46', 'Modbus 46', 'number', 'Official Modbus46: FE ext 0x6F; 4-byte signed LE int32'),
  ('galileosky', 'modbus.47', 'Modbus 47', 'number', 'Official Modbus47: FE ext 0x70; 4-byte signed LE int32'),
  ('galileosky', 'modbus.48', 'Modbus 48', 'number', 'Official Modbus48: FE ext 0x71; 4-byte signed LE int32'),
  ('galileosky', 'modbus.49', 'Modbus 49', 'number', 'Official Modbus49: FE ext 0x72; 4-byte signed LE int32'),
  ('galileosky', 'modbus.50', 'Modbus 50', 'number', 'Official Modbus50: FE ext 0x73; 4-byte signed LE int32'),
  ('galileosky', 'modbus.51', 'Modbus 51', 'number', 'Official Modbus51: FE ext 0x74; 4-byte signed LE int32'),
  ('galileosky', 'modbus.52', 'Modbus 52', 'number', 'Official Modbus52: FE ext 0x75; 4-byte signed LE int32'),
  ('galileosky', 'modbus.53', 'Modbus 53', 'number', 'Official Modbus53: FE ext 0x76; 4-byte signed LE int32'),
  ('galileosky', 'modbus.54', 'Modbus 54', 'number', 'Official Modbus54: FE ext 0x77; 4-byte signed LE int32'),
  ('galileosky', 'modbus.55', 'Modbus 55', 'number', 'Official Modbus55: FE ext 0x78; 4-byte signed LE int32'),
  ('galileosky', 'modbus.56', 'Modbus 56', 'number', 'Official Modbus56: FE ext 0x79; 4-byte signed LE int32'),
  ('galileosky', 'modbus.57', 'Modbus 57', 'number', 'Official Modbus57: FE ext 0x7A; 4-byte signed LE int32'),
  ('galileosky', 'modbus.58', 'Modbus 58', 'number', 'Official Modbus58: FE ext 0x7B; 4-byte signed LE int32'),
  ('galileosky', 'modbus.59', 'Modbus 59', 'number', 'Official Modbus59: FE ext 0x7C; 4-byte signed LE int32'),
  ('galileosky', 'modbus.60', 'Modbus 60', 'number', 'Official Modbus60: FE ext 0x7D; 4-byte signed LE int32'),
  ('galileosky', 'modbus.61', 'Modbus 61', 'number', 'Official Modbus61: FE ext 0x7E; 4-byte signed LE int32'),
  ('galileosky', 'modbus.62', 'Modbus 62', 'number', 'Official Modbus62: FE ext 0x7F; 4-byte signed LE int32'),
  ('galileosky', 'modbus.63', 'Modbus 63', 'number', 'Official Modbus63: FE ext 0x80; 4-byte signed LE int32')
ON CONFLICT (protocol, vendor_key) DO UPDATE SET
  label = EXCLUDED.label,
  value_type = EXCLUDED.value_type,
  description = EXCLUDED.description;

UPDATE tracker_protocol_params
SET description = 'Tag 0xFE: 2-byte LE length + (u16 ext_id + i32 value)*; Modbus/BLE/GSM'
WHERE protocol = 'galileosky' AND vendor_key = 'tag.0xfe';
