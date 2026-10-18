-- Align Teltonika remaps with FMB140 / FMB125 / FMB150 Data Sending Parameters wiki.
-- https://wiki.teltonika-gps.com/view/FMB140_Teltonika_Data_Sending_Parameters_ID
-- https://wiki.teltonika-gps.com/view/FMB125_Teltonika_Data_Sending_Parameters_ID
-- https://wiki.teltonika-gps.com/view/FMB150_Teltonika_Data_Sending_Parameters_ID

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'sd.status', 'SD card status', 'number', 'AVL 10: 0 absent / 1 present'),
  ('teltonika', 'trip.event', 'Trip event', 'number', 'AVL 250: 0 stop / 1 start'),
  ('teltonika', 'overspeed.speed', 'Overspeed event speed', 'number', 'AVL 255 km/h at event'),
  ('teltonika', 'geofence.zone11', 'Geofence zone 11', 'number', 'AVL 70 (FMB wiki)')
ON CONFLICT (protocol, vendor_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

UPDATE tracker_protocol_params SET description = 'AVL 6 Analog Input 2 ×0.001 V (not AVL 10)'
  WHERE protocol = 'teltonika' AND vendor_key = 'voltage.ain2';
UPDATE tracker_protocol_params SET label = 'BLE battery 1', description = 'AVL 29 % (was wrongly AVL 86)'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.battery';
UPDATE tracker_protocol_params SET label = 'BLE humidity 1', description = 'AVL 86 ×0.1 %RH (was wrongly AVL 29)'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.humidity';
UPDATE tracker_protocol_params SET description = 'AVL 104 ×0.1 %RH'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.humidity2';
UPDATE tracker_protocol_params SET description = 'AVL 106 ×0.1 %RH'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.humidity3';
UPDATE tracker_protocol_params SET description = 'AVL 108 ×0.1 %RH'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.humidity4';
UPDATE tracker_protocol_params SET description = 'AVL 25 signed ×0.01 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.temp1';
UPDATE tracker_protocol_params SET description = 'AVL 26 signed ×0.01 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.temp2';
UPDATE tracker_protocol_params SET description = 'AVL 27 signed ×0.01 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.temp3';
UPDATE tracker_protocol_params SET description = 'AVL 28 signed ×0.01 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'ble.temp4';
UPDATE tracker_protocol_params SET description = 'AVL 12 Fuel Used GPS ×0.001 L'
  WHERE protocol = 'teltonika' AND vendor_key = 'fuel.used';
UPDATE tracker_protocol_params SET description = 'AVL 13 Fuel Rate GPS ×0.01 l/100km'
  WHERE protocol = 'teltonika' AND vendor_key = 'fuel.rate';
UPDATE tracker_protocol_params SET description = 'AVL 72 Dallas Temperature 1 signed ×0.1 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'temp.1';
UPDATE tracker_protocol_params SET description = 'AVL 73 Dallas Temperature 2 signed ×0.1 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'temp.2';
UPDATE tracker_protocol_params SET description = 'AVL 74 Dallas Temperature 3 signed ×0.1 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'temp.3';
UPDATE tracker_protocol_params SET description = 'AVL 75 Dallas Temperature 4 signed ×0.1 °C'
  WHERE protocol = 'teltonika' AND vendor_key = 'temp.4';
UPDATE tracker_protocol_params SET description = 'AVL 13201 PCB Temperature signed ×0.1 °C (FMB wiki; not AVL 70)'
  WHERE protocol = 'teltonika' AND vendor_key = 'pcb.temp';
UPDATE tracker_protocol_params SET description = 'OBSOLETE key — AVL 250 is trip.event; distance is AVL 199 trip.odometer'
  WHERE protocol = 'teltonika' AND vendor_key = 'trip.distance';
UPDATE tracker_protocol_params SET description = 'OBSOLETE key — use overspeed.speed; AVL 255 is event km/h'
  WHERE protocol = 'teltonika' AND vendor_key = 'overspeed.threshold';
UPDATE tracker_protocol_params SET description = 'OBSOLETE — AVL 48 is OBD Fuel Level % on FMB wiki; not remapped'
  WHERE protocol = 'teltonika' AND vendor_key = 'fuel.used_total';
