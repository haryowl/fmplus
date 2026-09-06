-- Maintenance D2/D3: lines, service points, assign, PoM photos

ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS service_point_id UUID,
  ADD COLUMN IF NOT EXISTS service_point_name TEXT,
  ADD COLUMN IF NOT EXISTS service_point_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS service_point_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS assigned_field_user_id UUID REFERENCES field_users (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS service_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  notes TEXT,
  point_type TEXT,
  armada_poi_id INTEGER,
  armada_poi_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_points_tenant_name_idx
  ON service_points (tenant_id, lower(name));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_events_service_point_id_fkey'
  ) THEN
    ALTER TABLE service_events
      ADD CONSTRAINT service_events_service_point_id_fkey
      FOREIGN KEY (service_point_id) REFERENCES service_points (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS service_event_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES service_events (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('part', 'labor', 'other')),
  description TEXT NOT NULL DEFAULT '',
  qty DOUBLE PRECISION NOT NULL DEFAULT 1,
  unit_price DOUBLE PRECISION,
  unit_cost DOUBLE PRECISION,
  vendor TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_event_lines_event_idx ON service_event_lines (event_id, sort_order);

CREATE TABLE IF NOT EXISTS service_event_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES service_events (id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  content_type TEXT,
  bytes INTEGER,
  caption TEXT,
  uploaded_by_field_user_id UUID REFERENCES field_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_event_photos_event_idx
  ON service_event_photos (event_id, created_at DESC);
