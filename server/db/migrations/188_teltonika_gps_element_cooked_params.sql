-- Official Teltonika GPS Element + scaled AVL cooked keys for Live values / remaps.
-- Codec wiki: Longitude, Latitude, Altitude, Angle, Satellites, Speed.
-- FMB140 wiki: AVL 66 External Voltage ×0.001 V; AVL 67 Battery Voltage ×0.001 V.
-- AVL 16 Total Odometer = metres; AVL 389 OBD OEM Total Mileage = km (not metres).

INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'gps.longitude', 'GPS Longitude', 'number', 'Codec GPS Element Lon int32/1e7 (official order: Lon then Lat)'),
  ('teltonika', 'gps.latitude', 'GPS Latitude', 'number', 'Codec GPS Element Lat int32/1e7'),
  ('teltonika', 'gps.altitude', 'GPS Altitude', 'number', 'Codec GPS Element altitude metres'),
  ('teltonika', 'gps.angle', 'GPS Angle / Heading', 'number', 'Codec GPS Element Angle — degrees from north (0–360)'),
  ('teltonika', 'gps.satellites', 'GPS Satellites', 'number', 'Codec GPS Element satellites in use'),
  ('teltonika', 'gps.speed', 'GPS Speed', 'number', 'Codec GPS Element speed km/h (0 = invalid fix per wiki)'),
  ('teltonika', 'voltage.ext', 'External Voltage V', 'number', 'AVL 66 ×0.001 (mV→V) — FMB140 wiki'),
  ('teltonika', 'voltage.batt', 'Battery Voltage V', 'number', 'AVL 67 ×0.001 (mV→V) — FMB140 wiki'),
  ('teltonika', 'gps.source', 'GPS source', 'string', 'gps element or iso6709 (AVL 387) when present')
ON CONFLICT (protocol, vendor_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description;

-- Fix wrong remap from 053: AVL 389 is already km on FMB140 wiki (not metres×0.001).
UPDATE tracker_param_maps
SET transform = 'identity', transform_arg = '{}'::jsonb
WHERE vendor_key = 'io.389' AND app_param_id = 'odometer_km';

UPDATE tracker_protocol_params
SET description = 'AVL 389 OBD OEM Total Mileage (km) — FMB140 wiki; not metres'
WHERE protocol = 'teltonika' AND vendor_key = 'io.389';
