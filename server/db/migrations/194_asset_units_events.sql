-- Virtual GPS odometer, per-device trip detection, and classified Events.

ALTER TABLE tracker_devices
  ADD COLUMN IF NOT EXISTS gps_odometer_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS trip_mode TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS trip_min_speed_kmh DOUBLE PRECISION NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS trip_break_min INTEGER NOT NULL DEFAULT 5;

ALTER TABLE tracker_devices DROP CONSTRAINT IF EXISTS tracker_devices_trip_mode_check;
ALTER TABLE tracker_devices
  ADD CONSTRAINT tracker_devices_trip_mode_check
  CHECK (trip_mode IN ('default', 'speed', 'ignition'));

ALTER TABLE tracker_param_defs
  ADD COLUMN IF NOT EXISTS event_class TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS raise_alert BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emit_on TEXT NOT NULL DEFAULT 'event';

ALTER TABLE tracker_param_defs DROP CONSTRAINT IF EXISTS tracker_param_defs_event_class_check;
ALTER TABLE tracker_param_defs
  ADD CONSTRAINT tracker_param_defs_event_class_check
  CHECK (event_class IN ('safety', 'warning', 'asset', 'none'));

ALTER TABLE tracker_param_defs DROP CONSTRAINT IF EXISTS tracker_param_defs_emit_on_check;
ALTER TABLE tracker_param_defs
  ADD CONSTRAINT tracker_param_defs_emit_on_check
  CHECK (emit_on IN ('event', 'rising', 'falling', 'change', 'none'));

CREATE TABLE IF NOT EXISTS tracker_event_type_defs (
  alarm_type TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  event_class TEXT NOT NULL DEFAULT 'warning'
    CHECK (event_class IN ('safety', 'warning', 'asset', 'none')),
  raise_alert BOOLEAN NOT NULL DEFAULT true,
  emit_on TEXT NOT NULL DEFAULT 'event'
    CHECK (emit_on IN ('event', 'rising', 'falling', 'change', 'none'))
);

CREATE TABLE IF NOT EXISTS tracker_event_class_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants (id) ON DELETE CASCADE,
  profile_id UUID REFERENCES tracker_device_profiles (id) ON DELETE CASCADE,
  device_id UUID REFERENCES tracker_devices (id) ON DELETE CASCADE,
  alarm_type TEXT NOT NULL,
  event_class TEXT NOT NULL DEFAULT 'warning'
    CHECK (event_class IN ('safety', 'warning', 'asset', 'none')),
  raise_alert BOOLEAN NOT NULL DEFAULT true,
  emit_on TEXT NOT NULL DEFAULT 'event'
    CHECK (emit_on IN ('event', 'rising', 'falling', 'change', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tenant_id IS NOT NULL OR profile_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS tracker_event_class_maps_device_type_uidx
  ON tracker_event_class_maps (device_id, alarm_type)
  WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tracker_event_class_maps_profile_type_uidx
  ON tracker_event_class_maps (profile_id, alarm_type)
  WHERE profile_id IS NOT NULL AND device_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tracker_event_class_maps_tenant_type_uidx
  ON tracker_event_class_maps (tenant_id, alarm_type)
  WHERE tenant_id IS NOT NULL AND profile_id IS NULL AND device_id IS NULL;

INSERT INTO tracker_event_type_defs (alarm_type, label, event_class, raise_alert, emit_on) VALUES
  ('green_driving', 'Green driving', 'safety', true, 'event'),
  ('overspeed', 'Overspeed', 'safety', true, 'event'),
  ('crash', 'Crash', 'safety', true, 'event'),
  ('impact', 'Impact', 'safety', true, 'event'),
  ('tilt', 'Tilt', 'safety', true, 'event'),
  ('harsh_brake', 'Harsh brake', 'safety', true, 'event'),
  ('harsh_accel', 'Harsh acceleration', 'safety', true, 'event'),
  ('harsh_corner', 'Harsh corner', 'safety', true, 'event'),
  ('ignition', 'Ignition', 'asset', false, 'change'),
  ('movement', 'Movement', 'asset', false, 'change'),
  ('trip', 'Trip', 'asset', false, 'event'),
  ('door', 'Door', 'asset', false, 'event'),
  ('idling', 'Idling', 'asset', false, 'event'),
  ('geofence', 'Geofence', 'asset', false, 'event'),
  ('autogeofence', 'Auto geofence', 'asset', false, 'event'),
  ('power_ext', 'External power', 'warning', true, 'event'),
  ('unplug', 'Unplug', 'warning', true, 'event'),
  ('jamming', 'Jamming', 'warning', true, 'event'),
  ('gnss_antenna', 'GNSS antenna', 'warning', true, 'event'),
  ('battery_low', 'Battery low', 'warning', true, 'event'),
  ('towing', 'Towing', 'warning', true, 'event'),
  ('sos', 'SOS', 'warning', true, 'event'),
  ('fuel_theft', 'Fuel theft', 'warning', true, 'event'),
  ('sim_missing', 'SIM missing', 'warning', true, 'event'),
  ('ext_voltage', 'External voltage', 'warning', true, 'event'),
  ('bus_voltage', 'Bus voltage', 'warning', true, 'event'),
  ('video_loss', 'Video loss', 'none', false, 'none'),
  ('video_lost', 'Video lost', 'none', false, 'none'),
  ('snapshot', 'Snapshot', 'none', false, 'none'),
  ('photo', 'Photo', 'none', false, 'none'),
  ('media', 'Media', 'none', false, 'none')
ON CONFLICT (alarm_type) DO UPDATE SET
  label = EXCLUDED.label,
  event_class = EXCLUDED.event_class,
  raise_alert = EXCLUDED.raise_alert,
  emit_on = EXCLUDED.emit_on;

UPDATE tracker_param_defs SET
  event_class = 'asset', raise_alert = false, emit_on = 'change'
WHERE id IN ('ignition', 'movement');
