-- Plate parity for Jakarta ganjil–genap routing

ALTER TABLE vehicle_capacities
  ADD COLUMN IF NOT EXISTS plate_parity TEXT
    CHECK (plate_parity IS NULL OR plate_parity IN ('odd', 'even', 'unknown', 'exempt'));
