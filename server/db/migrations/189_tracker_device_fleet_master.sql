-- Fleet asset master fields on tracker devices + tenant custom field definitions.

ALTER TABLE tracker_devices
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS plate TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vin TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS make TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS model TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS model_year INTEGER,
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS camera_channels INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS custom_attrs JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS tracker_devices_plate_idx
  ON tracker_devices (tenant_id, lower(plate))
  WHERE plate <> '';

CREATE TABLE IF NOT EXISTS tracker_device_field_defs (
  id TEXT NOT NULL,
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'text'
    CHECK (value_type IN ('text', 'number', 'bool', 'date', 'select')),
  unit TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  select_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT tracker_device_field_defs_id_chk CHECK (id ~ '^[a-z][a-z0-9_]{1,62}$')
);

CREATE INDEX IF NOT EXISTS tracker_device_field_defs_tenant_idx
  ON tracker_device_field_defs (tenant_id, sort_order ASC, lower(label) ASC);
