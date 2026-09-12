-- Optional route start/end anchors (depot or vehicle last position).
-- Used for map path and Sequence display; not delivery stops.
-- route_anchor_mode: map | sequence (null = calc-only / none)

ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS route_start_lat DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS route_start_lon DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS route_start_label TEXT NULL,
  ADD COLUMN IF NOT EXISTS route_end_lat DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS route_end_lon DOUBLE PRECISION NULL,
  ADD COLUMN IF NOT EXISTS route_end_label TEXT NULL,
  ADD COLUMN IF NOT EXISTS route_anchor_mode TEXT NULL;
