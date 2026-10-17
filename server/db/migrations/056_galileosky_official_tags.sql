-- Align Galileosky default remaps with official tag table:
-- 0x01 = hardware version (not DIN); 0x46 = input status bits; 0x33 = speed/course.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('galileosky', 'tag.0x46', 'Input status', 'number', 'Bitmask of discrete inputs (official tag 0x46)'),
  ('galileosky', 'tag.0x01', 'Hardware version', 'number', 'Official tag 0x01 — not ignition'),
  ('galileosky', 'tag.0x02', 'Firmware version', 'number', 'Official tag 0x02'),
  ('galileosky', 'tag.0x33', 'Speed/course', 'object', 'Speed km/h and course ° (÷10)')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

-- Retarget system Galileosky profiles: ignition from input status bit0, not hw version.
UPDATE tracker_param_maps m
SET vendor_key = 'tag.0x46',
    transform = 'bit_mask',
    transform_arg = '{"mask":1}'::jsonb
FROM tracker_device_profiles p
WHERE m.profile_id = p.id
  AND p.tenant_id IS NULL
  AND p.protocol = 'galileosky'
  AND m.vendor_key = 'tag.0x01'
  AND m.app_param_id = 'ignition';

INSERT INTO tracker_param_maps (profile_id, vendor_key, app_param_id, transform, transform_arg)
SELECT p.id, 'tag.0x46', 'ignition', 'bit_mask', '{"mask":1}'::jsonb
FROM tracker_device_profiles p
WHERE p.tenant_id IS NULL AND p.protocol = 'galileosky'
  AND NOT EXISTS (
    SELECT 1 FROM tracker_param_maps r
    WHERE r.profile_id = p.id AND r.vendor_key = 'tag.0x46'
  );
