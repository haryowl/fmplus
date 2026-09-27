-- Shared scan identity for goods, maintenance parts, and later vehicle/location tags.
-- QR / barcode / NFC all resolve through catalog_codes.

CREATE TABLE IF NOT EXISTS catalog_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL
    CHECK (target_kind IN ('goods', 'maint_part', 'vehicle', 'location')),
  target_id UUID NOT NULL,
  code TEXT NOT NULL,
  code_format TEXT NOT NULL
    CHECK (code_format IN ('sku', 'ean', 'qr', 'nfc', 'other')),
  label TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS catalog_codes_target_idx
  ON catalog_codes (tenant_id, target_kind, target_id);

CREATE INDEX IF NOT EXISTS catalog_codes_code_idx
  ON catalog_codes (tenant_id, code);

ALTER TABLE maintenance_catalog_items
  ADD COLUMN IF NOT EXISTS sku TEXT;

ALTER TABLE dispatch_order_lines
  ADD COLUMN IF NOT EXISTS scanned_code TEXT,
  ADD COLUMN IF NOT EXISTS serial TEXT,
  ADD COLUMN IF NOT EXISTS lot TEXT,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;

ALTER TABLE service_event_lines
  ADD COLUMN IF NOT EXISTS scanned_code TEXT,
  ADD COLUMN IF NOT EXISTS serial TEXT,
  ADD COLUMN IF NOT EXISTS lot TEXT,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;

INSERT INTO catalog_codes (tenant_id, target_kind, target_id, code, code_format)
SELECT tenant_id, 'goods', id, lower(trim(sku)), 'sku'
FROM dispatch_goods_items
WHERE sku IS NOT NULL AND trim(sku) <> ''
ON CONFLICT (tenant_id, code) DO NOTHING;
