-- Desk privileges for Goods / Customers master edit (embed login reuse of field_users).
ALTER TABLE field_users
  ADD COLUMN IF NOT EXISTS privileges JSONB NOT NULL DEFAULT '{}'::jsonb;
