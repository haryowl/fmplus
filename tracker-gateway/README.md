# Tracker gateway (Go sidecar)

Pluggable GPS protocol adapters that terminate public ports, decode **raw vendor params**, apply **Device Manager remap**, and write canonical fixes into Postgres (`tracker_devices`, `vehicle_fixes`, `vehicle_last_fix`, `tracker_safety_events`, `tracker_commands`).

## Completeness status (honest)

| Adapter | Port env | Default | Status | Uplink | Downlink | Notes |
|---------|----------|---------|--------|--------|----------|-------|
| HTTP/JSON | `TRACKER_HTTP_ADDR` | `:5080` | **partial** | fix + heartbeat | — | `/ingest/v1/fix`, `/healthz`, `/adapters` |
| Teltonika Codec 8/8E | `TRACKER_TELTONIKA_ADDR` | `:5027` | **partial** | IO + CRC | Codec12 | event IO → safety for known alarms |
| JT/T 808 | `TRACKER_JT808_ADDR` | `:7611` | **partial** | location/TLV/batch | 0x8300/8103/8500 | alarm dword + Su Biao TLVs → safety |
| Su Biao overlay | `TRACKER_SUBIAO_ADDR` | `:7612` | **partial** | 808 + safety | same as 808 | ADAS/DSM/BSD TLVs → safety events |
| JT/T 809 | `TRACKER_JT809_ADDR` | `:8090` | **experimental** | login/heartbeat | — | platform link only |
| JT/T 1078 | `TRACKER_JT1078_ADDR` | `:1078` | **experimental** | signaling | — | A/V hooks only |
| Concox/GT06 | `TRACKER_CONCOX_ADDR` | `:5023` | **partial** | GPS/HB/alarm | 0x80 GPRS | heartbeat patches ACC without 0,0 fix |
| Ruptela | `TRACKER_RUPTELA_ADDR` | `:3047` | **partial** | records + IO | cmd 108 SMS | config responses → command ack |
| Galileosky | `TRACKER_GALILEOSKY_ADDR` | `:30175` | **partial** | tags | 0x01 framed | reply tags → command ack; compressed experimental |

**Do not claim “full JT/T” or production 2-way until an adapter is marked `certified`.** Status lives in each `Adapter.Status()` and Admin protocol labels.

### Command types (Admin → Device Manager)

| `command_type` | Protocols | Encode path |
|----------------|-----------|--------------|
| `text` | jt808/subiao (0x8300), generic | JT808 text or raw bytes |
| `jt808_8103` / `param` | jt808/subiao | set terminal params |
| `jt808_8500` / `control` | jt808/subiao | vehicle control |
| `teltonika_codec12` | teltonika | Codec 12 GPRS |
| `concox_gprs` | concox | GT06 0x80 |
| `ruptela_sms` | ruptela | command 108 |
| `raw` | any | hex payload as-is |

Stale commands: **pending** > 24h or **sent** > 30m → `expired`. Encode/write errors → `failed`. Admin can **cancel** pending commands (not already sent). Remap rules support transforms: `identity`, `scale`, `offset`, `bit_mask`, `invert_bool`, `enum_map`.

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

Batch: `{"imei":"…","fixes":[{"lat":…,"lon":…}, …]}` (same auth). Heartbeat without coords: `{"heartbeat":true}` (updates `last_seen_at` only).

Also: `GET /healthz`, `GET /metrics`, `GET /adapters`.

## Device Manager

Admin → tenant → **Device Manager**:

- Pick a **profile** (Teltonika FMB, JT808+Su Biao, …)
- Map vendor keys (`io.239`, `add.0x01`, `tag.0x33`, `alarm.sos`, …) → app params
- Queue **downlink** commands (flushed when device is online)
- **Refresh gateway status** for online sessions / adapter catalog

## Extending protocols

```go
type Adapter struct{}
func (Adapter) Name() string { return "vendorx" }
func (Adapter) Status() string { return protocol.StatusExperimental }
func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error { ... }
```

Register in `main.go` and add Admin protocol option + `tracker_protocol_params` seeds.
