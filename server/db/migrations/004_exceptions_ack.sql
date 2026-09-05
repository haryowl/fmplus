-- Exceptions inbox: local ack overlay on Armada notifier rows
ALTER TABLE armada_notifications
  ADD COLUMN IF NOT EXISTS acked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acked_note TEXT;

CREATE INDEX IF NOT EXISTS armada_notifications_tenant_open_idx
  ON armada_notifications (tenant_id, created_at DESC)
  WHERE kind = 'exception' AND acked_at IS NULL;
