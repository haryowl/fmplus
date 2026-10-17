-- Teltonika barcode, BT status, BLE fuel level, OEM fuel level.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'barcode.id', 'Barcode ID', 'string', 'AVL IO 264 ASCII'),
  ('teltonika', 'bt.status', 'Bluetooth status', 'number', 'AVL IO 263'),
  ('teltonika', 'ble.fuel1', 'BLE fuel level 1', 'number', 'AVL IO 270'),
  ('teltonika', 'fuel.oem_level', 'OEM fuel level L', 'number', 'AVL IO 390 ×0.1')
ON CONFLICT (protocol, vendor_key) DO NOTHING;
