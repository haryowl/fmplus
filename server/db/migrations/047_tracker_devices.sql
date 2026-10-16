-- Direct GPS tracker ingest (Go gateway + HTTP/JSON) alongside Armada.
-- Phone duty pings stay in driver_pings; device fixes live here.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS telematics_source TEXT NOT NULL DEFAULT 'both'
    CHECK (telematics_source IN ('armada', 'devices', 'both'));

CREATE TABLE IF NOT EXISTS tracker_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  imei TEXT NOT NULL,
  unique_id TEXT,
  protocol TEXT NOT NULL DEFAULT 'json'
    CHECK (protocol IN (
      'json', 'teltonika', 'jt808', 'concox', 'ruptela', 'galileosky', 'video', 'other'
    )),
  label TEXT NOT NULL DEFAULT '',
  armada_user_id INTEGER,
  auth_token_hash TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, imei)
);

CREATE INDEX IF NOT EXISTS tracker_devices_tenant_idx ON tracker_devices (tenant_id);
CREATE INDEX IF NOT EXISTS tracker_devices_armada_idx
  ON tracker_devices (tenant_id, armada_user_id)
  WHERE armada_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tracker_devices_imei_idx ON tracker_devices (imei);

CREATE TABLE IF NOT EXISTS vehicle_fixes (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES tracker_devices (id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  ignition BOOLEAN,
  odometer DOUBLE PRECISION,
  altitude DOUBLE PRECISION,
  satellites INTEGER,
  raw_attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_protocol TEXT NOT NULL DEFAULT 'json',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_fixes_device_time_idx
  ON vehicle_fixes (tenant_id, device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_fixes_time_idx ON vehicle_fixes (recorded_at DESC);

CREATE TABLE IF NOT EXISTS vehicle_last_fix (
  device_id UUID PRIMARY KEY REFERENCES tracker_devices (id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  ignition BOOLEAN,
  odometer DOUBLE PRECISION,
  altitude DOUBLE PRECISION,
  satellites INTEGER,
  raw_attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_protocol TEXT NOT NULL DEFAULT 'json',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vehicle_last_fix_tenant_idx ON vehicle_last_fix (tenant_id);
