# Tracker gateway (Go sidecar)

Pluggable GPS protocol adapters that terminate public ports, decode **raw vendor params**, apply **Device Manager remap**, and write canonical fixes into Postgres (`tracker_devices`, `vehicle_fixes`, `vehicle_last_fix`, `tracker_safety_events`, `tracker_commands`).

## Completeness status (honest)

| Adapter | Port env | Default | Status | Uplink | Downlink | Notes |
|---------|----------|---------|--------|--------|----------|-------|
| HTTP/JSON | `TRACKER_HTTP_ADDR` | `:5080` | **partial** | fix + heartbeat + alarm safety | — | nested attrs flatten; `alarm.*` → safety |
| Teltonika Codec 8/8E | `TRACKER_TELTONIKA_ADDR` | `:5027` | **partial** | IO + CRC | Codec12 | event IO → safety for known alarms |
| JT/T 808 | `TRACKER_JT808_ADDR` | `:7611` | **partial** | location/TLV/0702/0107/0301 | 0x8300/8103/8104/8500 | driver ID; outbound subpkg; ack corr |
| Su Biao overlay | `TRACKER_SUBIAO_ADDR` | `:7612` | **partial** | 808 + safety | same as 808 | ADAS/DSM/BSD TLVs → safety events |
| JT/T 809 | `TRACKER_JT809_ADDR` | `:8090` | **experimental** | login/heartbeat | — | platform link only |
| JT/T 1078 | `TRACKER_JT1078_ADDR` | `:1078` | **experimental** | signaling | — | A/V hooks only |
| Concox/GT06 | `TRACKER_CONCOX_ADDR` | `:5023` | **partial** | GPS/HB/alarm/0x8a/0x94/0x21 | 0x80 GPRS | 0x7979 long frames; 0x16 offset scan; ack by serial |
| Ruptela | `TRACKER_RUPTELA_ADDR` | `:3047` | **partial** | cmd 1/68 records | cmd 108 SMS | Kermit CRC; ACK 100; cmd7 ack corr=`108` |
| Galileosky | `TRACKER_GALILEOSKY_ADDR` | `:30175` | **partial** | tags + multi-record | 0x01 + CRC | archive bit; split on 0x30; ignition `0x46` |

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
| `jt808_8103` / `param` | jt808/subiao | set terminal params |
| `jt808_8104` / `query_params` | jt808/subiao | query params (`all` or id list) |
| `jt808_8107` / `query_attrs` | jt808/subiao | query terminal attributes |
| `jt808_8201` / `query_location` | jt808/subiao | query current location |
| `jt808_8500` / `control` | jt808/subiao | vehicle control |
| `teltonika_codec12` | teltonika | Codec 12 GPRS |
| `concox_gprs` | concox | GT06 0x80 |
| `ruptela_sms` | ruptela | command 108 |
| `galileosky_text` | galileosky | 0x01 + CRC-16 Modbus text |
| `raw` | any | hex payload as-is |

Stale commands: **pending** > 24h or **sent** > 30m → `expired`. Encode/write errors → `failed`. Admin can **cancel** pending commands (not already sent). Sent commands store `corr_id` (JT808 seq / Concox serial); terminal `0x0001` acks match by corr before falling back to latest-sent. Remap rules support transforms: `identity`, `scale`, `offset`, `bit_mask`, `invert_bool`, `enum_map`.

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
- **Refresh gateway status** for online sessions / adapter catalog

## Extending protocols

```go
type Adapter struct{}
func (Adapter) Name() string { return "vendorx" }
func (Adapter) Status() string { return protocol.StatusExperimental }
func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error { ... }
```

Register in `main.go` and add Admin protocol option + `tracker_protocol_params` seeds.
