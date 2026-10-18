-- Tenant-owned app parameter defs (system seeds keep tenant_id NULL).
-- App param id stays globally unique (TEXT PK) so remap FK continues to work.

ALTER TABLE tracker_param_defs
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS tracker_param_defs_tenant_idx
  ON tracker_param_defs (tenant_id);

COMMENT ON COLUMN tracker_param_defs.tenant_id IS
  'NULL = system seed; non-NULL = tenant-owned custom (id must still be globally unique)';
