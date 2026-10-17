# Tracker gateway (Go sidecar)

Pluggable GPS protocol adapters that terminate public ports, decode **raw vendor params**, apply **Device Manager remap**, and write canonical fixes into Postgres (`tracker_devices`, `vehicle_fixes`, `vehicle_last_fix`, `tracker_safety_events`, `tracker_commands`).

## Completeness status (honest)

| Adapter | Port env | Default | Status | Uplink | Downlink | Notes |
|---------|----------|---------|--------|--------|----------|-------|
| HTTP/JSON | `TRACKER_HTTP_ADDR` | `:5080` | **partial** | fix + heartbeat + alarm safety | — | nested attrs flatten; `alarm.*` → safety |
| Teltonika Codec 8/8E/16 | `TRACKER_TELTONIKA_ADDR` | `:5027` | **partial** | IO + CRC | Codec12/14 | Codec13/14; BLE/accel/green-driving; soft corr |
| JT/T 808 | `TRACKER_JT808_ADDR` | `:7611` | **partial** | register/auth/loc/TLV/alarms/0003–5/0500/0301–3/0608/0700–5/0800–5/0802 | 8300–4/8103–7/8201–4/8500/8600–7/8608/8700–2/8801–5/8900/9101–2 | areas+routes; media; record; info |
| Su Biao overlay | `TRACKER_SUBIAO_ADDR` | `:7612` | **partial** | 808 + safety | same as 808 | ADAS/DSM/BSD TLVs → safety events |
| JT/T 809 | `TRACKER_JT809_ADDR` | `:8090` | **experimental** | login/HB + 0x1200–06 + 0x1400 + 0x1500 + 0x1601–2 | — | 0x5B CRC; skip encrypted bodies |
| JT/T 1078 | `TRACKER_JT1078_ADDR` | `:1078` | **experimental** | signaling + ACK + SIM + header/payload hints | — | no RTP / no 808 media bridge |
| Concox/GT06 | `TRACKER_CONCOX_ADDR` | `:5023` | **partial** | GPS/HB/alarm/LBS | 0x80 GPRS | paused for depth — GT06 deferred |
| Ruptela | `TRACKER_RUPTELA_ADDR` | `:3047` | **partial** | cmd 1/68 records + cmd3 ident | 108/105/107 | voltage/fuel/temp/GSM IO; SOS/door; soft corr |
| Galileosky | `TRACKER_GALILEOSKY_ADDR` | `:30175` | **partial** | tags + multi-record | 0x01 + CRC | hw/fw + fuel/user/analog; CRLF cmds; soft corr |

**Do not claim “full JT/T” or production 2-way until an adapter is marked `certified`.** Status lives in each `Adapter.Status()` and Admin protocol labels.

### Official protocol sources

| Vendor | Docs used |
|--------|-----------|
| Teltonika | [Codec](https://wiki.teltonika-gps.com/view/Codec) (8 / 8E / 12), [Data Sending Protocols](https://wiki.teltonika-gps.com/view/Teltonika_Data_Sending_Protocols), [Parameter / AVL IDs](https://wiki.teltonika-gps.com/view/Parameter_list) (e.g. FMB `io.239` ignition, `246` towing, `247` crash, `255` overspeed) |
| Galileosky | [Protocol](https://base.galileosky.com/articles/#!en-documentation/galileosky-protocol), [Command list](https://base.galileosky.com/articles/#!en-documentation/command-list/q/command/qp/1) (SPA — cross-checked with published server-exchange PDF: CRC-16 Modbus, ack `0x02`+CRC, tag table) |
| Concox / CMS | [CMSV7 download center](https://www.cmsv7.com/downloadCenter/index.html?lang=en&pageNow=1&pageSize=12&class1=3&class2=) + GT06 family protocol (login `0x01`, GPS `0x12`/`0x22`, status `0x13`, alarm `0x16`, time `0x8a`, info `0x94`, server cmd `0x80`, CRC-ITU) |
| Ruptela | FM protocol PDF (CRC-CCITT Kermit over payload; records cmd `1`/`68`; server ACK cmd `100`; SMS cmd `108`) |

Adapters stay **partial** until exercised against real devices/firmware; wiki/PDF variance by model is expected.

### Command types (Admin → Device Manager)

| `command_type` | Protocols | Encode path |
|----------------|-----------|--------------|
| `text` | jt808/subiao (0x8300), generic | JT808 text or raw bytes |
| `jt808_8301` / `event_set` | jt808/subiao | set event menu items |
| `jt808_8302` / `question` | jt808/subiao | question prompt (→0x0302) |
| `jt808_8303` / `info_menu` | jt808/subiao | info on-demand menu set/clear |
| `jt808_8304` / `info` | jt808/subiao | information service push |
| `jt808_8103` / `param` | jt808/subiao | set terminal params |
| `jt808_8104` / `query_params` | jt808/subiao | query params (`all` or id list) |
| `jt808_8106` / `query_param_ids` | jt808/subiao | query designated param ids (→0x0106) |
| `jt808_8107` / `query_attrs` | jt808/subiao | query terminal attributes |
| `jt808_8108` / `terminal_upgrade` | jt808/subiao | upgrade notify (→0x0108) |
| `jt808_8400` / `phone_callback` | jt808/subiao | phone callback / listen-in |
| `jt808_8401` / `phonebook` | jt808/subiao | set / clear phone book |
| `jt808_8201` / `query_location` | jt808/subiao | query current location |
| `jt808_8105` / `terminal_control` | jt808/subiao | reset/shutdown/factory/… |
| `jt808_8500` / `control` | jt808/subiao | vehicle control |
| `jt808_8801` / `camera` | jt808/subiao | camera shoot (pairs 0x0805) |
| `jt808_8802` / `multimedia_retrieve` | jt808/subiao | stored media retrieve (→0x0802) |
| `jt808_8803` / `multimedia_control` | jt808/subiao | media upload start/stop |
| `jt808_8804` / `record_audio` | jt808/subiao | recording start/stop |
| `jt808_8805` / `multimedia_upload` | jt808/subiao | single media by id |
| `jt808_8900` / `transparent` | jt808/subiao | transparent downlink |
| `jt808_8202` / `track` | jt808/subiao | temporary location track |
| `jt808_8702` / `driver_query` | jt808/subiao | request driver identity (→0x0702) |
| `jt808_8700` / `driving_record` | jt808/subiao | driving record collect (→0x0700) |
| `jt808_8204` / `link_detect` | jt808/subiao | 2019 link detection |
| `teltonika_codec12` | teltonika | Codec 12 GPRS |
| `teltonika_codec14` | teltonika | Codec 14 GPRS (IMEI gated) |
| `jt808_8203` / `alarm_confirm` | jt808/subiao | manual confirm alarm |
| `jt808_8600` / `geofence_set` | jt808/subiao | set circle/rect/poly/route (`type=…`) |
| `jt808_8602` | jt808/subiao | set rectangular area (minimal) |
| `jt808_8604` | jt808/subiao | set polygon area (minimal) |
| `jt808_8606` / `route_set` | jt808/subiao | set route (minimal inflection pts) |
| `jt808_8601` / `geofence_del` | jt808/subiao | delete areas (`type=rect|poly|route`) |
| `jt808_8603` | jt808/subiao | delete rectangular area(s) |
| `jt808_8605` | jt808/subiao | delete polygon area(s) |
| `jt808_8607` / `route_del` | jt808/subiao | delete route(s) |
| `jt808_8608` / `geofence_query` | jt808/subiao | query areas/routes (→0x0608) |
| `jt808_9101` / `av_live` | jt808/subiao | realtime AV request (1078 path) |
| `jt808_9102` / `av_control` | jt808/subiao | AV realtime control |
| `concox_gprs` | concox | GT06 0x80 |
| `ruptela_sms` | ruptela | command 108 |
| `ruptela_105` / `config` | ruptela | command 105 |
| `ruptela_107` | ruptela | command 107 |
| `galileosky_text` | galileosky | 0x01 + CRC-16 Modbus text |
| `raw` | any | hex payload as-is |

Stale commands: **pending** > 24h or **sent** > 30m → `expired`. Encode/write errors → `failed`. Admin can **cancel** pending commands (not already sent). Pending rows are **atomically claimed** (`FOR UPDATE SKIP LOCKED`) so dispatch and session flush cannot double-send. Sent commands store `corr_id` (JT808 seq / Concox serial / Ruptela `108` / soft `txt:…` for Codec12 & Galileosky). Terminal acks match by corr or payload-text echo (`AckSoftOrLatest`) before falling back to latest-sent. Remap rules support transforms: `identity`, `scale`, `offset`, `bit_mask`, `invert_bool`, `enum_map`.

JT808 location fixes flatten `alarm.*` bits and `status.acc` onto `raw_attrs` for Device Manager remap (same keys as safety events).

## Architecture

1. **Protocol adapters** (`internal/protocol`) — register, listen, decode, ACK, optional downlink encode.
2. **Sessions** — live TCP map for pending `tracker_commands` (`GET /adapters` online count).
3. **Ingest** — `raw_attrs` (vendor) → Device Manager remap → `mapped_attrs` + typed columns.
4. **Device Manager** (Admin UI + `server/device-manager.mjs`) — profiles, vendor→app param maps, command queue, safety events.

Adding a new GPS brand or HTTP API: implement `protocol.Adapter`, register in `main.go`, seed protocol params/profile — Live merge code stays unchanged.

## Run

```bash
# migrate first — device manager + command types + IO/alarm seeds
#   050_device_manager.sql
#   051_tracker_command_types.sql
#   052_subiao_protocol_params.sql
#   053_teltonika_io_depth.sql
#   054_concox_alarm_maps.sql
#   055_subiao_event_maps.sql
#   056_galileosky_official_tags.sql
#   057_galileosky_command_type.sql
#   058_teltonika_avl_concox_alarms.sql
#   059_json_alarm_params.sql
#   060_tracker_command_corr.sql
#   061_jt808_query_commands.sql
#   062_jt808_location_tlv_params.sql
#   063_jt808_driver_params.sql
#   064_jt808_8201_ruptela_alarms.sql
#   065_jt808_8105_terminal_control.sql
#   066_concox_alarm_lbs_maps.sql
#   067_uplink_remap_seeds.sql
#   068_uplink_remap_seeds.sql
#   069_uplink_remap_seeds.sql
#   070_uplink_remap_seeds.sql
#   071_ruptela_cmd_types.sql
#   072_jt808_camera_track.sql
#   073_jt808_driver_record.sql
#   074_codec14_geofence.sql
#   075_jt808_av_geofence_query.sql
#   076_jt808_geofence_set_alarm.sql
#   077_jt808_media_retrieve.sql
#   078_jt808_rect_geofence.sql
#   079_jt808_event_question.sql
#   080_jt808_poly_info.sql
#   081_jt808_geofence_del_media.sql
#   082_jt808_info_menu.sql
#   083_jt808_route_media_ctrl.sql
#   084_jt808_param_ids_record.sql
#   085_jt808_phone_ruptela_io.sql
#   086_jt808_0106_upgrade.sql
#   087_teltonika_ruptela_jt809_depth.sql
#   088_jt808_video_galileosky_can.sql
#   089_jt808_alarm_bits_jt1078_live.sql
npm run db:migrate

cd tracker-gateway
go mod tidy
go run .
```

Requires `DATABASE_URL` (same as fms-embed).

Admin gateway status proxy: set `TRACKER_GATEWAY_URL` (default `http://127.0.0.1:5080`) so Device Manager can call `/healthz` + `/adapters`.

## HTTP ingest

```bash
curl -X POST http://localhost:5080/ingest/v1/fix \
  -H "Authorization: Bearer <device-token>" \
  -H "Content-Type: application/json" \
  -d '{"lat":-6.2,"lon":106.8,"speed":40,"ignition":true,"attrs":{"io":{"239":1}}}'
```

Batch: `{"imei":"…","fixes":[{"lat":…,"lon":…}, …]}` (same auth). Heartbeat without coords: `{"heartbeat":true}` (updates `last_seen_at`; optional `attrs`/`status.acc` patch last status). Nested `attrs.io` / `alarm` / `status` flatten to dotted vendor keys; `alarm.*` / known `event_io` also insert safety events.

Also: `GET /healthz`, `GET /metrics`, `GET /adapters`.

## Device Manager

Admin → tenant → **Device Manager**:

- Pick a **profile** (Teltonika FMB, JT808+Su Biao, …)
- Map vendor keys (`io.239`, `add.0x01`, `tag.0x33`, `alarm.sos`, `adas.fcw`, …) → app params (profile or per-device override)
- Transforms: `identity` / `scale` / `bit_mask` / …
- Queue **downlink** commands (flushed when device is online); cancel pending from Admin
- **Refresh gateway status** for online sessions, command queue breakdown, decode errors, adapter ports
- Queue commands with **payload text** and optional **payload hex** (8103 TLV / raw)

## Extending protocols

```go
type Adapter struct{}
func (Adapter) Name() string { return "vendorx" }
func (Adapter) Status() string { return protocol.StatusExperimental }
func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error { ... }
```

Register in `main.go` and add Admin protocol option + `tracker_protocol_params` seeds.
