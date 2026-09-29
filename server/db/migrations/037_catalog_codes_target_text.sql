-- Vehicle tags use Armada user ids (e.g. 1855); location/goods/parts keep UUID strings.
-- target_id must be text so all four target kinds share one codes table.
ALTER TABLE catalog_codes
  ALTER COLUMN target_id TYPE TEXT
  USING target_id::text;
