# Tracker gateway (Go sidecar)

Pluggable GPS protocol adapters that terminate public ports, decode **raw vendor params**, apply **Device Manager remap**, and write canonical fixes into Postgres (`tracker_devices`, `vehicle_fixes`, `vehicle_last_fix`, `tracker_safety_events`).

## Completeness status (honest)

| Adapter | Port env | Default | Status |
|---------|----------|---------|--------|
| HTTP/JSON | `TRACKER_HTTP_ADDR` | `:5080` | **partial** |
| Teltonika Codec 8/8E | `TRACKER_TELTONIKA_ADDR` | `:5027` | **partial** (full IO extract + CRC check) |
| JT/T 808 | `TRACKER_JT808_ADDR` | `:7611` | **partial** (location TLV, batch `0x0704`, text downlink) |
| Su Biao overlay | `TRACKER_SUBIAO_ADDR` | `:7612` | **mvp** (808 framing + safety events) |
| JT/T 809 | `TRACKER_JT809_ADDR` | `:8090` | **experimental** |
| JT/T 1078 | `TRACKER_JT1078_ADDR` | `:1078` | **experimental** (signaling hooks only) |
| Concox/GT06 | `TRACKER_CONCOX_ADDR` | `:5023` | **mvp** |
| Ruptela | `TRACKER_RUPTELA_ADDR` | `:3047` | **mvp** |
| Galileosky | `TRACKER_GALILEOSKY_ADDR` | `:30175` | **partial** (tags; compressed experimental) |

**Do not claim “full JT/T” or production 2-way until an adapter is marked `certified`.** Status lives in each `Adapter.Status()` and Admin protocol labels.

## Architecture

1. **Protocol adapters** (`internal/protocol`) — register, listen, decode, ACK, optional downlink encode.
2. **Sessions** — live TCP map for pending `tracker_commands`.
3. **Ingest** — `raw_attrs` (vendor) → Device Manager remap → `mapped_attrs` + typed columns.
4. **Device Manager** (Admin UI + `server/device-manager.mjs`) — profiles, vendor→app param maps, command queue, safety events.

Adding a new GPS brand or HTTP API: implement `protocol.Adapter`, register in `main.go`, seed protocol params/profile — Live merge code stays unchanged.

## Run

```bash
# migrate first (050_device_manager.sql)
npm run db:migrate

cd tracker-gateway
go mod tidy
go run .
```

Requires `DATABASE_URL` (same as fms-embed).

## HTTP ingest

```bash
curl -X POST http://localhost:5080/ingest/v1/fix \
  -H "Authorization: Bearer <device-token>" \
  -H "Content-Type: application/json" \
  -d '{"lat":-6.2,"lon":106.8,"speed":40,"ignition":true,"attrs":{"io":{"239":1}}}'
```

Also: `GET /healthz`, `GET /metrics`, `GET /adapters`.

## Device Manager

Admin → tenant → **Device Manager**:

- Pick a **profile** (Teltonika FMB, JT808+Su Biao, …)
- Map vendor keys (`io.239`, `add.0x01`, `tag.0x33`, …) → app params (`ignition`, `odometer_km`, `adas_fcw`, …)
- Queue **downlink** text commands (flushed when device is online)

## Extending protocols

```go
type Adapter struct{}
func (Adapter) Name() string { return "vendorx" }
func (Adapter) Status() string { return protocol.StatusExperimental }
func (Adapter) Serve(ctx context.Context, addr string, deps protocol.Deps) error { ... }
```

Register in `main.go` and add Admin protocol option + `tracker_protocol_params` seeds.
