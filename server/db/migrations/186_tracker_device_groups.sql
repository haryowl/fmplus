-- Tenant fleet / device groups (M2M). Shared by Admin, Live Ops, Dispatch, Maintenance.

CREATE TABLE IF NOT EXISTS tracker_device_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS tracker_device_groups_tenant_idx
  ON tracker_device_groups (tenant_id, sort_order ASC, lower(name) ASC);

CREATE TABLE IF NOT EXISTS tracker_device_group_members (
  group_id UUID NOT NULL REFERENCES tracker_device_groups (id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES tracker_devices (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, device_id)
);

CREATE INDEX IF NOT EXISTS tracker_device_group_members_device_idx
  ON tracker_device_group_members (device_id);

COMMENT ON TABLE tracker_device_groups IS
  'Tenant-owned fleet buckets for Device Manager / Live / Dispatch / Maintenance scope';
COMMENT ON TABLE tracker_device_group_members IS
  'M2M: a device may belong to many groups';
