-- Gateway connection / auth events for Admin Terminal (includes unregistered IMEIs).
CREATE TABLE IF NOT EXISTS tracker_gateway_events (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  imei TEXT,
  protocol TEXT NOT NULL DEFAULT 'other',
  remote TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracker_gateway_events_created_idx
  ON tracker_gateway_events (created_at DESC);

CREATE INDEX IF NOT EXISTS tracker_gateway_events_imei_created_idx
  ON tracker_gateway_events (imei, created_at DESC)
  WHERE imei IS NOT NULL;
