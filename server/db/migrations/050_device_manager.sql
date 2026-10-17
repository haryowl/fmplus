-- Device Manager: canonical params, profiles, remap rules, mapped_attrs, commands, safety events.

ALTER TABLE vehicle_fixes
  ADD COLUMN IF NOT EXISTS mapped_attrs JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE vehicle_last_fix
  ADD COLUMN IF NOT EXISTS mapped_attrs JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Canonical application parameter catalog (seeded).
CREATE TABLE IF NOT EXISTS tracker_param_defs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'avl'
    CHECK (category IN ('avl', 'safety', 'video', 'other')),
  value_type TEXT NOT NULL DEFAULT 'number'
    CHECK (value_type IN ('bool', 'number', 'string')),
  unit TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);

-- Known vendor keys per protocol (documentation + Admin picker).
CREATE TABLE IF NOT EXISTS tracker_protocol_params (
  protocol TEXT NOT NULL,
  vendor_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  value_type TEXT NOT NULL DEFAULT 'number',
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (protocol, vendor_key)
);

CREATE TABLE IF NOT EXISTS tracker_device_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants (id) ON DELETE CASCADE,
  -- NULL tenant_id = system/global profile
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  completeness TEXT NOT NULL DEFAULT 'mvp'
    CHECK (completeness IN ('mvp', 'partial', 'certified', 'experimental')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracker_device_profiles_tenant_idx
  ON tracker_device_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS tracker_device_profiles_protocol_idx
  ON tracker_device_profiles (protocol);

ALTER TABLE tracker_devices
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES tracker_device_profiles (id) ON DELETE SET NULL;

-- Remap: vendor_key in raw_attrs → app param id.
CREATE TABLE IF NOT EXISTS tracker_param_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES tracker_device_profiles (id) ON DELETE CASCADE,
  device_id UUID REFERENCES tracker_devices (id) ON DELETE CASCADE,
  vendor_key TEXT NOT NULL,
  app_param_id TEXT NOT NULL REFERENCES tracker_param_defs (id) ON DELETE CASCADE,
  transform TEXT NOT NULL DEFAULT 'identity'
    CHECK (transform IN ('identity', 'scale', 'offset', 'enum_map', 'bit_mask', 'invert_bool')),
  transform_arg JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (profile_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS tracker_param_maps_profile_idx ON tracker_param_maps (profile_id);
CREATE INDEX IF NOT EXISTS tracker_param_maps_device_idx ON tracker_param_maps (device_id);

-- Downlink command queue (2-way).
CREATE TABLE IF NOT EXISTS tracker_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES tracker_devices (id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  command_type TEXT NOT NULL DEFAULT 'raw'
    CHECK (command_type IN ('raw', 'text', 'jt808', 'teltonika_codec12')),
  payload_text TEXT NOT NULL DEFAULT '',
  payload_hex TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'acked', 'failed', 'expired')),
  response_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tracker_commands_pending_idx
  ON tracker_commands (device_id, created_at)
  WHERE status = 'pending';

-- Active safety / Su Biao style events.
CREATE TABLE IF NOT EXISTS tracker_safety_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES tracker_devices (id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL,
  alarm_type TEXT NOT NULL,
  alarm_level INTEGER NOT NULL DEFAULT 0,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  attachment_id TEXT NOT NULL DEFAULT '',
  source_protocol TEXT NOT NULL DEFAULT 'jt808',
  raw_attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  mapped_attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracker_safety_events_device_time_idx
  ON tracker_safety_events (tenant_id, device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS tracker_safety_events_type_idx
  ON tracker_safety_events (tenant_id, alarm_type, recorded_at DESC);

-- Expand protocol check on tracker_devices for JT family.
ALTER TABLE tracker_devices DROP CONSTRAINT IF EXISTS tracker_devices_protocol_check;
ALTER TABLE tracker_devices
  ADD CONSTRAINT tracker_devices_protocol_check CHECK (protocol IN (
    'json', 'teltonika', 'jt808', 'jt809', 'jt1078', 'subiao',
    'concox', 'ruptela', 'galileosky', 'video', 'other'
  ));

-- Seed canonical app params.
INSERT INTO tracker_param_defs (id, category, value_type, unit, label, description) VALUES
  ('ignition', 'avl', 'bool', '', 'Ignition', 'Engine ignition / DIN1'),
  ('movement', 'avl', 'bool', '', 'Movement', 'Device movement flag'),
  ('odometer_km', 'avl', 'number', 'km', 'Odometer', 'Total distance'),
  ('engine_hours', 'avl', 'number', 'h', 'Engine hours', 'Total engine hours'),
  ('fuel_level', 'avl', 'number', '%', 'Fuel level', 'Fuel percentage'),
  ('fuel_liters', 'avl', 'number', 'L', 'Fuel liters', 'Fuel volume'),
  ('battery_voltage', 'avl', 'number', 'V', 'Battery voltage', 'Internal battery'),
  ('ext_voltage', 'avl', 'number', 'V', 'External voltage', 'Vehicle power'),
  ('coolant_temp', 'avl', 'number', 'C', 'Coolant temp', 'Engine coolant'),
  ('ambient_temp', 'avl', 'number', 'C', 'Ambient temp', 'Outside temperature'),
  ('driver_id', 'avl', 'string', '', 'Driver ID', 'iButton / RFID'),
  ('door_open', 'avl', 'bool', '', 'Door open', 'Door / digital input'),
  ('sos', 'avl', 'bool', '', 'SOS', 'Panic / SOS button'),
  ('tow', 'avl', 'bool', '', 'Tow', 'Tow / movement when ignition off'),
  ('jamming', 'avl', 'bool', '', 'Jamming', 'GNSS/GSM jamming'),
  ('gsm_signal', 'avl', 'number', '', 'GSM signal', 'Signal strength'),
  ('satellites', 'avl', 'number', '', 'Satellites', 'GNSS satellite count'),
  ('hdop', 'avl', 'number', '', 'HDOP', 'Horizontal dilution'),
  ('speed_kmh', 'avl', 'number', 'km/h', 'Speed', 'Ground speed'),
  ('heading_deg', 'avl', 'number', 'deg', 'Heading', 'Course over ground'),
  ('adas_fcw', 'safety', 'bool', '', 'ADAS FCW', 'Forward collision warning'),
  ('adas_ldw', 'safety', 'bool', '', 'ADAS LDW', 'Lane departure warning'),
  ('adas_pcw', 'safety', 'bool', '', 'ADAS PCW', 'Pedestrian collision warning'),
  ('dsm_fatigue', 'safety', 'bool', '', 'DSM fatigue', 'Driver fatigue'),
  ('dsm_phone', 'safety', 'bool', '', 'DSM phone', 'Phone use while driving'),
  ('dsm_smoke', 'safety', 'bool', '', 'DSM smoke', 'Smoking while driving'),
  ('bsd_blind', 'safety', 'bool', '', 'BSD', 'Blind spot detection'),
  ('alarm_level', 'safety', 'number', '', 'Alarm level', 'Active safety severity'),
  ('alarm_attachment_id', 'safety', 'string', '', 'Alarm attachment', 'Evidence file / attachment id')
ON CONFLICT (id) DO NOTHING;

-- Seed common vendor keys (Teltonika AVL ids, Galileosky tags, JT additional info).
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('teltonika', 'io.239', 'Ignition (AVL 239)', 'bool', 'Digital ignition'),
  ('teltonika', 'io.240', 'Movement (AVL 240)', 'bool', 'Movement'),
  ('teltonika', 'io.66', 'Ext voltage (AVL 66)', 'number', 'External voltage mV'),
  ('teltonika', 'io.67', 'Battery (AVL 67)', 'number', 'Battery voltage mV'),
  ('teltonika', 'io.16', 'Total odometer (AVL 16)', 'number', 'Odometer'),
  ('teltonika', 'io.21', 'GSM signal (AVL 21)', 'number', 'GSM signal'),
  ('teltonika', 'io.1', 'DIN1 (AVL 1)', 'bool', 'Digital input 1'),
  ('galileosky', 'tag.0x30', 'Coordinates', 'string', 'Lat/lon/sats tag'),
  ('galileosky', 'tag.0x33', 'Speed/course', 'number', 'Speed and course'),
  ('galileosky', 'tag.0x20', 'DateTime', 'number', 'Device time'),
  ('jt808', 'add.0x01', 'Mileage', 'number', 'Additional info mileage'),
  ('jt808', 'add.0x02', 'Fuel', 'number', 'Additional info fuel'),
  ('jt808', 'add.0x03', 'Speed', 'number', 'Additional info speed'),
  ('jt808', 'add.0x14', 'Video alarm', 'number', 'Video-related alarm'),
  ('subiao', 'adas.fcw', 'FCW', 'bool', 'Su Biao forward collision'),
  ('subiao', 'adas.ldw', 'LDW', 'bool', 'Su Biao lane departure'),
  ('subiao', 'dsm.fatigue', 'Fatigue', 'bool', 'Su Biao DSM fatigue'),
  ('subiao', 'dsm.phone', 'Phone', 'bool', 'Su Biao DSM phone'),
  ('concox', 'status.acc', 'ACC', 'bool', 'Concox ACC bit'),
  ('ruptela', 'io.event', 'Event IO', 'number', 'Ruptela event IO id'),
  ('json', 'ignition', 'Ignition', 'bool', 'JSON body ignition'),
  ('json', 'odometer', 'Odometer', 'number', 'JSON body odometer')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

-- Global default profiles (tenant_id NULL).
INSERT INTO tracker_device_profiles (id, tenant_id, name, protocol, model, completeness, notes)
SELECT gen_random_uuid(), NULL, v.name, v.protocol, v.model, 'mvp', v.notes
FROM (VALUES
  ('Teltonika FMB default', 'teltonika', 'FMB', 'Codec 8/8E IO extract — MVP until certified'),
  ('JT/T 808 basic', 'jt808', '808', 'Location + additional info — MVP'),
  ('JT/T 808 + Su Biao', 'subiao', 'SuBiao', 'Active safety overlay — MVP'),
  ('Galileosky Easy/Main', 'galileosky', 'Easy', 'Tag stream — MVP; compressed experimental'),
  ('Concox GT06 family', 'concox', 'GT06', 'Login/GPS/heartbeat — MVP'),
  ('Ruptela FM', 'ruptela', 'FM', 'Records packet — MVP'),
  ('HTTP/JSON ingest', 'json', 'API', 'JSON fix ingest — MVP'),
  ('JT/T 809 platform', 'jt809', '809', 'Platform exchange — experimental'),
  ('JT/T 1078 A/V', 'jt1078', '1078', 'Video signaling hooks — experimental')
) AS v(name, protocol, model, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM tracker_device_profiles p
  WHERE p.tenant_id IS NULL AND p.protocol = v.protocol AND p.name = v.name
);

-- Default Teltonika profile remap rules (vendor IO → app params).
INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, m.transform, m.transform_arg::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('io.239', 'ignition', 'identity', '{}'),
  ('io.240', 'movement', 'identity', '{}'),
  ('io.16', 'odometer_km', 'scale', '{"scale":0.001}'),
  ('io.66', 'ext_voltage', 'scale', '{"scale":0.001}'),
  ('io.67', 'battery_voltage', 'scale', '{"scale":0.001}'),
  ('io.21', 'gsm_signal', 'identity', '{}')
) AS m(vendor_key, app_param_id, transform, transform_arg)
WHERE p.tenant_id IS NULL AND p.protocol = 'teltonika' AND p.name = 'Teltonika FMB default'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

-- Default JT808 / Su Biao profile remaps.
INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('add.0x01', 'odometer_km'),
  ('add.0x02', 'fuel_liters'),
  ('add.0x03', 'speed_kmh')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'jt808'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, m.vendor_key, m.app_param_id, 'identity', '{}'::jsonb
FROM tracker_device_profiles p
CROSS JOIN (VALUES
  ('adas.fcw', 'adas_fcw'),
  ('adas.ldw', 'adas_ldw'),
  ('dsm.fatigue', 'dsm_fatigue'),
  ('dsm.phone', 'dsm_phone')
) AS m(vendor_key, app_param_id)
WHERE p.tenant_id IS NULL AND p.protocol = 'subiao'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = m.vendor_key
  );
