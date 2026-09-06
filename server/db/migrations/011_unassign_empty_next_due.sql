-- Clear technician assignment on empty auto-spawned next-due jobs
-- (older builds copied assignment on Done, which put blank follow-ups back on /m).
UPDATE service_events e
SET assigned_field_user_id = NULL,
    updated_at = now()
WHERE e.status IN ('due', 'in_progress')
  AND e.parent_event_id IS NOT NULL
  AND e.assigned_field_user_id IS NOT NULL
  AND (e.notes IS NULL OR btrim(e.notes) = '')
  AND NOT EXISTS (SELECT 1 FROM service_event_lines l WHERE l.event_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM service_event_photos p WHERE p.event_id = e.id);
