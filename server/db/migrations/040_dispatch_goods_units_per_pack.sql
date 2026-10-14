-- Pack conversion: how many pcs are in one catalog unit (e.g. 1 box = 12 pcs).
-- Null when the sell/stock unit is already pcs (or kg/L).

ALTER TABLE dispatch_goods_items
  ADD COLUMN IF NOT EXISTS units_per_pack DOUBLE PRECISION;
