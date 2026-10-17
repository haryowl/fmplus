-- Escort LLS / BLE fuel 2–4 + Ruptela barcode/BT/VIN/DTC/fuel parity.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'ble.fuel_temp1', 'Escort LLS temp 1 C', 'number', 'AVL IO 269 signed'),
  ('teltonika', 'ble.fuel_batt1', 'Escort LLS batt 1 V', 'number', 'AVL IO 271 ×0.01'),
  ('teltonika', 'ble.fuel_temp2', 'Escort LLS temp 2 C', 'number', 'AVL IO 272 signed'),
  ('teltonika', 'ble.fuel2', 'BLE fuel level 2', 'number', 'AVL IO 273'),
  ('teltonika', 'ble.fuel3', 'BLE fuel level 3', 'number', 'AVL IO 276'),
  ('teltonika', 'ble.fuel4', 'BLE fuel level 4', 'number', 'AVL IO 279'),
  ('ruptela', 'barcode.id', 'Barcode ID', 'string', 'IO 264'),
  ('ruptela', 'bt.status', 'Bluetooth status', 'number', 'IO 263'),
  ('ruptela', 'ble.fuel1', 'BLE fuel level 1', 'number', 'IO 270'),
  ('ruptela', 'ble.fuel_temp1', 'Escort LLS temp 1 C', 'number', 'IO 269 signed'),
  ('ruptela', 'ble.fuel_batt1', 'Escort LLS batt 1 V', 'number', 'IO 271 ×0.01'),
  ('ruptela', 'ble.fuel_temp2', 'Escort LLS temp 2 C', 'number', 'IO 272 signed'),
  ('ruptela', 'ble.fuel2', 'BLE fuel level 2', 'number', 'IO 273'),
  ('ruptela', 'ble.fuel3', 'BLE fuel level 3', 'number', 'IO 276'),
  ('ruptela', 'ble.fuel4', 'BLE fuel level 4', 'number', 'IO 279'),
  ('ruptela', 'fuel.oem_level', 'OEM fuel level L', 'number', 'IO 390 ×0.1'),
  ('ruptela', 'vehicle.vin', 'Vehicle VIN', 'string', 'IO 256'),
  ('ruptela', 'obd.fault_codes', 'OBD fault codes', 'string', 'IO 281')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
