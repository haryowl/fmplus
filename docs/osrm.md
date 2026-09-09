# OSRM for FM Plus Route plan

Route plan (`/route`) talks to a **local OSRM HTTP server**. The browser never calls OSRM; only the Node app does via `OSRM_BASE_URL`.

Without OSRM, Route plan still works with **straight-line (haversine)** estimates.

## 1. Requirements (VPS)

| Item | Guidance |
|------|----------|
| Docker | Required for the script below |
| Disk | Indonesia PBF ~1GB+; built graph often several GB more |
| RAM | Extract often needs **8GB+** for full Indonesia; use a smaller region if the VPS is small |
| Port | `5000` on localhost (do **not** expose publicly unless firewalled) |

Smaller Geofabrik extracts (faster/lighter), examples:

- Java: `https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf`
- Full ID: `https://download.geofabrik.de/asia/indonesia-latest.osm.pbf`

## 2. Build + start OSRM (one-time)

On the VPS, in the FM Plus repo:

```bash
cd /root/fmplus/fmplus   # or your deploy path
git pull
chmod +x scripts/setup-osrm.sh

# Recommended first try — Java only (lighter than all of Indonesia)
PBF_URL=https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf ./scripts/setup-osrm.sh
```

This downloads the PBF into `data/osrm/`, runs `osrm-extract` → `partition` → `customize`, then starts container **`fmplus-osrm`** on `127.0.0.1:5000`.

Later restarts (data already built):

```bash
./scripts/setup-osrm.sh --start-only
# or
docker start fmplus-osrm
```

Smoke test:

```bash
curl -s "http://127.0.0.1:5000/route/v1/driving/106.8272,-6.1754;106.8456,-6.2088?overview=false"
```

You should see JSON with `"code":"Ok"`.

## 3. Point FM Plus at OSRM

In `.env.local` (same directory as `server.mjs`):

```bash
OSRM_BASE_URL=http://127.0.0.1:5000
```

Restart:

```bash
systemctl restart fmplus
```

Then Admin → enable **Route plan**, open `/route?k=…`. The header should say **OSRM roads** (not “straight-line estimate”).

Optional Docker Compose (after data is built under `data/osrm/` with basename `java-latest` or set `OSRM_GRAPH`):

```bash
OSRM_GRAPH=java-latest docker compose --profile osrm up -d osrm
```

## 4. Troubleshooting

| Symptom | Check |
|---------|--------|
| Banner still says OSRM not configured | `OSRM_BASE_URL` missing; restart fmplus; confirm env is loaded |
| Configured but falls back to haversine | `curl` OSRM smoke test; `docker logs fmplus-osrm` |
| Extract OOM killed | Use a smaller `PBF_URL` region, or add RAM/swap |
| Routes outside the extract | Stops must be inside the built map (e.g. Java extract won’t route Sulawesi) |

Do **not** use the public `router.project-osrm.org` for production — it is not a free private API and rate-limits heavily.
