-- Unknown tracker IMEIs seen by the gateway, waiting for Admin claim into a tenant.
CREATE TABLE IF NOT EXISTS tracker_unassigned (
  imei TEXT PRIMARY KEY,
  protocol TEXT NOT NULL DEFAULT 'other',
  last_remote TEXT,
  hit_count INTEGER NOT NULL DEFAULT 1 CHECK (hit_count >= 1),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracker_unassigned_last_seen_idx
  ON tracker_unassigned (last_seen_at DESC);
