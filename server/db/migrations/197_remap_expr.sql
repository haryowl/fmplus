ALTER TABLE tracker_param_maps
  DROP CONSTRAINT IF EXISTS tracker_param_maps_transform_check;

ALTER TABLE tracker_param_maps
  ADD CONSTRAINT tracker_param_maps_transform_check
  CHECK (transform IN ('identity', 'scale', 'offset', 'enum_map', 'bit_mask', 'invert_bool', 'expr'));
