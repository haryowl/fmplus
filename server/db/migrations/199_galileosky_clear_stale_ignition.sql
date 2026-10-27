-- Drop leftover Galileosky assumed-ignition remaps on tenant clones (198 only
-- touched tenant_id IS NULL), then clear last-fix ignition when nothing maps it.

DELETE FROM tracker_param_maps m
USING tracker_device_profiles p
WHERE m.profile_id = p.id
  AND p.protocol = 'galileosky'
  AND m.device_id IS NULL
  AND m.app_param_id = 'ignition'
  AND m.vendor_key IN (
    'tag.0x46', 'tag.0x41', 'tag.0x01',
    'status.acc', 'status.ignition', 'ignition'
  );

DELETE FROM tracker_param_maps m
USING tracker_devices d
WHERE m.device_id = d.id
  AND d.protocol = 'galileosky'
  AND m.app_param_id = 'ignition'
  AND m.vendor_key IN (
    'tag.0x46', 'tag.0x41', 'tag.0x01',
    'status.acc', 'status.ignition', 'ignition'
  );

UPDATE vehicle_last_fix lf
SET ignition = NULL,
    mapped_attrs = COALESCE(lf.mapped_attrs, '{}'::jsonb)
      - 'ignition' - 'status.ignition' - 'status.acc',
    raw_attrs = COALESCE(lf.raw_attrs, '{}'::jsonb)
      - 'ignition' - 'status.ignition' - 'status.acc'
FROM tracker_devices d
WHERE lf.device_id = d.id
  AND d.protocol = 'galileosky'
  AND NOT EXISTS (
    SELECT 1
    FROM tracker_param_maps m
    WHERE m.app_param_id = 'ignition'
      AND m.enabled = true
      AND (
        m.device_id = d.id
        OR (m.device_id IS NULL AND m.profile_id IS NOT DISTINCT FROM d.profile_id)
      )
  );
