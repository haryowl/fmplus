-- Galileosky device.imei/id; JT809 0x1208 driver report; JT808 waybill.text alias.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'device.imei', 'Device IMEI', 'string', 'Tag 0x03'),
  ('galileosky', 'device.id', 'Device id', 'number', 'Tag 0x04'),
  ('jt809', 'driver_report', 'Driver report', 'bool', '0x1208'),
  ('jt809', 'driver_state', 'Driver state', 'number', '0x1208'),
  ('jt808', 'waybill.text', 'Waybill text', 'string', '0x0701'),
  ('jt808', 'waybill_len', 'Waybill length', 'number', '0x0701')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
