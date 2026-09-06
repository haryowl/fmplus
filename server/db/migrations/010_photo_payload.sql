-- Inline photo bytes when object storage (S3/MinIO) is not configured
ALTER TABLE service_event_photos
  ADD COLUMN IF NOT EXISTS payload BYTEA;
