-- JT808 emit meta (param/transparent/area/CAN); Subiao driver/upgrade/transparent/media/safety inherit; Galileosky tag 0x50/51.
INSERT INTO tracker_protocol_params (protocol, vendor_key, label, value_type, description) VALUES
  ('jt808', 'param_count', 'Param count', 'number', '0x0104/0x0106 response'),
  ('jt808', 'transparent_hex', 'Transparent payload hex', 'string', '0x0900 body snip'),
  ('jt808', 'area_head_hex', 'Area query head hex', 'string', '0x0608 response snip'),
  ('jt808', 'can.first_data', 'First CAN data', 'string', '0x0705 first item hex'),
  ('jt808', 'can_item_count', 'CAN item count', 'number', '0x0705'),
  ('jt808', 'can_head_hex', 'CAN head snip', 'string', '0x0705'),
  ('jt808', 'reply_seq', 'Reply serial', 'number', '0x0805/0x0802'),
  ('jt808', 'shoot_result', 'Camera shoot result', 'number', '0x0805'),
  ('jt808', 'subiao_type', 'Su Biao TLV type', 'string', 'ADAS/DSM/TPMS/BSD TLV'),
  ('jt808', 'subiao_event', 'Su Biao event name', 'string', 'Decoded event'),
  ('jt808', 'subiao_level', 'Su Biao level', 'number', 'Decoded level'),
  ('jt808', 'subiao_event_id', 'Su Biao event id', 'number', 'Raw event type'),
  ('subiao', 'param_count', 'Param count', 'number', 'Inherited JT808 0x0104'),
  ('subiao', 'transparent_hex', 'Transparent payload hex', 'string', 'Inherited JT808 0x0900'),
  ('subiao', 'transparent_type', 'Transparent type', 'number', 'Inherited JT808 0x0900'),
  ('subiao', 'area_head_hex', 'Area query head hex', 'string', 'Inherited JT808 0x0608'),
  ('subiao', 'can.first_data', 'First CAN data', 'string', 'Inherited JT808 0x0705'),
  ('subiao', 'can_item_count', 'CAN item count', 'number', 'Inherited JT808 0x0705'),
  ('subiao', 'driver_state', 'Driver state', 'number', 'Inherited JT808 0x0702'),
  ('subiao', 'driver_cert', 'Driver certificate', 'string', 'Inherited JT808 0x0702'),
  ('subiao', 'driver_time', 'Driver time', 'string', 'Inherited JT808 0x0702'),
  ('subiao', 'driver_ic_result', 'Driver IC result', 'number', 'Inherited JT808 0x0702'),
  ('subiao', 'upgrade_type', 'Upgrade type', 'number', 'Inherited JT808 0x0108'),
  ('subiao', 'upgrade_result', 'Upgrade result', 'number', 'Inherited JT808 0x0108'),
  ('subiao', 'reply_seq', 'Reply serial', 'number', 'Inherited JT808 0x0805'),
  ('subiao', 'shoot_result', 'Camera shoot result', 'number', 'Inherited JT808 0x0805'),
  ('subiao', 'media_ids', 'Media ID list', 'string', 'Inherited JT808 0x0805'),
  ('subiao', 'subiao_type', 'Su Biao TLV type', 'string', 'ADAS/DSM/TPMS/BSD TLV'),
  ('subiao', 'subiao_event', 'Su Biao event name', 'string', 'Decoded event'),
  ('subiao', 'subiao_level', 'Su Biao level', 'number', 'Decoded level'),
  ('subiao', 'subiao_event_id', 'Su Biao event id', 'number', 'Raw event type'),
  ('subiao', 'io.status', 'IO status word', 'number', 'Inherited JT808 TLV 0x18'),
  ('subiao', 'io.status32', 'IO status dword', 'number', 'Inherited JT808 TLV 0x2A'),
  ('galileosky', 'tag.0x50', 'Analog 0x50 raw mV', 'number', 'Before voltage.ext hoist'),
  ('galileosky', 'tag.0x51', 'Analog 0x51 raw mV', 'number', 'Before voltage.batt hoist')
ON CONFLICT (protocol, vendor_key) DO NOTHING;

UPDATE tracker_protocol_params
SET value_type = 'string', description = 'Inherited JT808 0x0108 kind label'
WHERE protocol = 'subiao' AND vendor_key = 'upgrade_kind' AND value_type = 'number';
