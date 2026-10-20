-- Phase 2: allow Dispatch / Maintenance jobs to attach a GPS tracker device
-- without requiring an Armada user link (Armada embed pages remain Armada-keyed).

ALTER TABLE dispatch_jobs
  ADD COLUMN IF NOT EXISTS tracker_device_id UUID REFERENCES tracker_devices (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dispatch_jobs_tenant_device_idx
  ON dispatch_jobs (tenant_id, tracker_device_id)
  WHERE tracker_device_id IS NOT NULL;

ALTER TABLE service_events
  ADD COLUMN IF NOT EXISTS tracker_device_id UUID REFERENCES tracker_devices (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS service_events_tenant_device_idx
  ON service_events (tenant_id, tracker_device_id)
  WHERE tracker_device_id IS NOT NULL;

COMMENT ON COLUMN dispatch_jobs.tracker_device_id IS
  'Optional GPS device for device-native jobs; Armada user id remains optional.';
COMMENT ON COLUMN service_events.tracker_device_id IS
  'Optional GPS device for device-native maintenance; Armada user id remains optional.';
