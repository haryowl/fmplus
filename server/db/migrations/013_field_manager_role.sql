-- Allow field_users.role = manager (Manager Maintenance PWA /mm).
ALTER TABLE field_users DROP CONSTRAINT IF EXISTS field_users_role_check;
ALTER TABLE field_users
  ADD CONSTRAINT field_users_role_check
  CHECK (role IN ('operator', 'driver', 'dispatcher', 'manager'));
