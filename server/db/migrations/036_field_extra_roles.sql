-- Extra Field person roles for Admin assignment + scan switchboard columns.
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
    'field2'
  ));
