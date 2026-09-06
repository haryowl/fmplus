-- Catalog (Part / Service / Others), approved lock, line catalog links

ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by TEXT;

ALTER TABLE service_events DROP CONSTRAINT IF EXISTS service_events_status_check;
ALTER TABLE service_events
  ADD CONSTRAINT service_events_status_check
  CHECK (status IN ('due', 'in_progress', 'done', 'skipped', 'approved'));

ALTER TABLE service_event_lines DROP CONSTRAINT IF EXISTS service_event_lines_kind_check;
ALTER TABLE service_event_lines
  ADD CONSTRAINT service_event_lines_kind_check
  CHECK (kind IN ('part', 'labor', 'service', 'other'));

CREATE TABLE IF NOT EXISTS maintenance_catalog_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key IN ('part', 'service', 'other')),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS maintenance_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES maintenance_catalog_groups (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit_price DOUBLE PRECISION,
  unit_cost DOUBLE PRECISION,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_catalog_items_group_idx
  ON maintenance_catalog_items (group_id, sort_order, name);

CREATE INDEX IF NOT EXISTS maintenance_catalog_items_tenant_idx
  ON maintenance_catalog_items (tenant_id, enabled);

ALTER TABLE service_event_lines
  ADD COLUMN IF NOT EXISTS catalog_item_id UUID REFERENCES maintenance_catalog_items (id) ON DELETE SET NULL;
