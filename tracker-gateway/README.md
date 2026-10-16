# Tracker gateway (Go sidecar)

Terminates public GPS tracker protocols and writes normalized fixes into the same Postgres as fms-embed (`tracker_devices`, `vehicle_fixes`, `vehicle_last_fix`).

## Listeners

| Env | Default | Protocol |
|-----|---------|----------|
| `TRACKER_HTTP_ADDR` | `:5080` | JSON `POST /ingest/v1/fix` + `/healthz` |
| `TRACKER_TELTONIKA_ADDR` | `:5027` | Teltonika Codec 8 / 8E TCP |
| `TRACKER_JT808_ADDR` | `:7611` | JT/T 808 TCP (register / auth / location) |
| `TRACKER_CONCOX_ADDR` | `:5023` | Concox / GT06-family TCP |
| `TRACKER_RUPTELA_ADDR` | `:3047` | Ruptela FM TCP |
| `TRACKER_GALILEOSKY_ADDR` | `:30175` | Galileosky Easy/Main TCP |
| `DATABASE_URL` | required | Postgres |
| `VEHICLE_FIX_RETENTION_DAYS` | `14` | History prune |

Devices must be registered in **Admin → Tracker devices** with matching **protocol** and **IMEI**. HTTP ingest uses the device Bearer token; TCP protocols authenticate by IMEI.

## Run

```bash
# from repo root, with DATABASE_URL set (same as fms-embed)
cd tracker-gateway
go mod tidy
go run .
```

Point units at the matching host:port (or POST JSON):

```bash
curl -X POST http://localhost:5080/ingest/v1/fix \
  -H "Authorization: Bearer <device-token>" \
  -H "Content-Type: application/json" \
  -d '{"lat":-6.2,"lon":106.8,"speed":40}'
```

Node also exposes `POST /api/tracker/ingest/v1/fix` for the same JSON path without running this sidecar.

## Protocol notes

- **Concox**: login `0x01`, GPS `0x12`/`0x22`, heartbeat `0x13` — GT06 clones may vary; unknown IMEI is rejected.
- **Ruptela**: records packet id `1`, server ACK id `100`.
- **Galileosky**: header `0x01` tag stream (`0x03` IMEI, `0x30` coordinates); server ACK `0x02`.
