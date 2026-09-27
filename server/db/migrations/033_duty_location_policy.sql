-- Per-tenant Field GPS cadence (seconds / metres). Null = server default (15 / 60 / 25).
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS duty_ping_interval_sec INTEGER,
  ADD COLUMN IF NOT EXISTS duty_ping_quiet_sec INTEGER,
  ADD COLUMN IF NOT EXISTS duty_ping_min_move_m INTEGER;

COMMENT ON COLUMN tenants.duty_ping_interval_sec IS
  'Fastest Field GPS record while moving, seconds. Null uses 15 or DUTY_PING_INTERVAL_SEC.';
COMMENT ON COLUMN tenants.duty_ping_quiet_sec IS
  'Parked Field GPS heartbeat, seconds. Null uses 60 or DUTY_PING_QUIET_SEC.';
COMMENT ON COLUMN tenants.duty_ping_min_move_m IS
  'Metres the phone must move after the interval. Null uses 25 or DUTY_PING_MIN_MOVE_M.';
