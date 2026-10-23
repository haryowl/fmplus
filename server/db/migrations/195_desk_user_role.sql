-- Desk "User" role: signs in on the main Login page and uses desk modules
-- according to field_users.privileges (not Field /m or Manager /mm).
ALTER TABLE field_users DROP CONSTRAINT IF EXISTS field_users_role_check;
ALTER TABLE field_users
  ADD CONSTRAINT field_users_role_check
  CHECK (role IN (
    'operator',
    'driver',
    'dispatcher',
    'manager',
    'worker1',
    'worker2',
    'field1',
    'field2',
    'user'
  ));
