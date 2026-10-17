-- Correlate terminal acks to a specific sent command (JT808 response seq, etc.).
ALTER TABLE tracker_commands
  ADD COLUMN IF NOT EXISTS corr_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS tracker_commands_device_corr_idx
  ON tracker_commands (device_id, corr_id)
  WHERE status = 'sent' AND corr_id <> '';
