# OSRM for FM Plus Route plan + Dispatch

Route plan (`/route`) and Dispatch Jobs talk to a **local OSRM HTTP server**. The browser never calls OSRM; only the Node app does via `OSRM_BASE_URL`.

Without OSRM, both features still work with **straight-line (haversine)** estimates.

## Coverage (important)

OSRM only road-routes **inside the built extract**.

| Graph | Java | Sumatra | Kalimantan | Sulawesi | Notes |
|-------|------|---------|------------|----------|-------|
| `sulawesi-latest` | no | no | no | yes | What you have if Sulawesi-only was built |
| `java-latest` | yes | no | no | no | Java fleets only |
| `id-java-sumatra-kalimantan-sulawesi` | yes | yes | yes | yes | **Recommended for FM Plus** |
| `indonesia-latest` | yes | yes | yes | yes | Full country; larger disk/RAM |

That is why Sulawesi showed a road line while Java did not: the running graph was Sulawesi-only.

## 1. Requirements (VPS)

| Item | Guidance |
|------|----------|
| Docker | Required |
| Disk | Four-island merge: ~1.5–3GB PBF + several GB graph files |
| RAM | Extract often needs **8GB+** (16GB safer for merge + extract) |
| Port | `5000` on localhost (do **not** expose publicly unless firewalled) |

Geofabrik region files (names are English: **sumatra**, not sumatera):

- Java: `https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf`
- Sumatra: `https://download.geofabrik.de/asia/indonesia/sumatra-latest.osm.pbf`
- Kalimantan: `https://download.geofabrik.de/asia/indonesia/kalimantan-latest.osm.pbf`
- Sulawesi: `https://download.geofabrik.de/asia/indonesia/sulawesi-latest.osm.pbf`
- Full ID: `https://download.geofabrik.de/asia/indonesia-latest.osm.pbf`

## 2. Build the four-island graph (recommended)

On the VPS, in the FM Plus repo:

```bash
cd /root/fmplus/fmplus   # or your deploy path
git pull
chmod +x scripts/setup-osrm.sh

# Downloads Java + Sumatra + Kalimantan + Sulawesi, merges with osmium
# (Docker Hub `iboates/osmium`, or `apt install osmium-tool` if needed), builds OSRM, starts container
./scripts/setup-osrm.sh --regions=java,sumatra,kalimantan,sulawesi
```

If merge fails with `ghcr.io/... denied`, pull has already been fixed to use Docker Hub. Immediate workaround on the VPS:

```bash
apt-get update && apt-get install -y osmium-tool
./scripts/setup-osrm.sh --regions=java,sumatra,kalimantan,sulawesi
```

This writes under `data/osrm/`:

- merged PBF: `id-java-sumatra-kalimantan-sulawesi.osm.pbf`
- graph: `id-java-sumatra-kalimantan-sulawesi.osrm*`
- container: **`fmplus-osrm`** on `127.0.0.1:5000`

Later restarts (data already built):

```bash
OSRM_GRAPH=id-java-sumatra-kalimantan-sulawesi ./scripts/setup-osrm.sh --start-only
# or
docker start fmplus-osrm
```

### Smoke tests

```bash
# Java (Jakarta) — must return "code":"Ok"
curl -s "http://127.0.0.1:5000/route/v1/driving/106.8272,-6.1754;106.8456,-6.2088?overview=false"

# Sulawesi sample — must also return "code":"Ok"
curl -s "http://127.0.0.1:5000/route/v1/driving/122.5149,-3.9778;122.5900,-3.9500?overview=false"
```

If Java returns `NoRoute` / error but Sulawesi is `Ok`, you are still on a Sulawesi-only graph — rebuild with `--regions=...` above.

## 3. Point FM Plus at OSRM

In `.env.local` (same directory as `server.mjs`):

```bash
OSRM_BASE_URL=http://127.0.0.1:5000
```

Restart:

```bash
systemctl restart fmplus
```

Then open `/route?k=…` — header should say **OSRM roads**. Dispatch Jobs should draw road paths on Java and Sulawesi.

### Jakarta ganjil–genap (odd/even plate)

FM Plus can avoid ganjil–genap corridors when the rule is **in force** and the vehicle plate **does not match** the calendar date (or plate is unknown).

1. **App logic** (no rebuild): schedule in `server/data/jakarta-ganjil-genap.json`, plate parity on vehicle capacity, UI checkboxes on Route plan / Dispatch.
2. **Hard avoid in OSRM** (rebuild once): tag corridors with excludable class `ganjil_genap`:

```bash
node scripts/build-osrm-fmplus-profile.mjs
# Confirm log shows: Patched excludable (+ ganjil_genap) and Patched process_way

GRAPH=id-java-sumatra-kalimantan-sulawesi
# Use the .osm.pbf you already merged (same basename as the graph)
docker run --rm -t \
  -v "$PWD/data/osrm:/data" \
  -v "$PWD/osrm-profiles:/profiles" \
  ghcr.io/project-osrm/osrm-backend:latest \
  osrm-extract -p /profiles/car-fmplus.lua /data/${GRAPH}.osm.pbf

docker run --rm -t -v "$PWD/data/osrm:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-partition /data/${GRAPH}.osrm

docker run --rm -t -v "$PWD/data/osrm:/data" ghcr.io/project-osrm/osrm-backend:latest \
  osrm-customize /data/${GRAPH}.osrm

docker restart fmplus-osrm
# or: OSRM_GRAPH=$GRAPH ./scripts/setup-osrm.sh --start-only
systemctl restart fmplus
```

Until that rebuild, Optimize still runs but warns that corridor exclude is unavailable.

Optional alternate graph (corridors always blocked): set `OSRM_BASE_URL_RESTRICTED` — used when avoid is required.

Optional Compose (after the graph exists):

```bash
OSRM_GRAPH=id-java-sumatra-kalimantan-sulawesi docker compose --profile osrm up -d osrm
```

## 4. Alternatives

**Single island (legacy):**

```bash
PBF_URL=https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf ./scripts/setup-osrm.sh
```

**Whole Indonesia (simplest coverage, heaviest build):**

```bash
PBF_URL=https://download.geofabrik.de/asia/indonesia-latest.osm.pbf ./scripts/setup-osrm.sh
```

## 5. Troubleshooting

| Symptom | Check |
|---------|--------|
| Banner still says OSRM not configured | `OSRM_BASE_URL` missing; restart fmplus; confirm env is loaded |
| Sulawesi roads OK, Java straight / NoRoute | Graph is Sulawesi-only → rebuild with `--regions=java,sumatra,kalimantan,sulawesi` |
| Configured but falls back to haversine | Smoke-test both islands; `docker logs fmplus-osrm` |
| Extract OOM killed | Add RAM/swap, or build fewer regions |
| Wrong graph after rebuild | `docker rm -f fmplus-osrm` then `--start-only` with `OSRM_GRAPH=...` |

Do **not** use the public `router.project-osrm.org` for production — it is not a free private API and rate-limits heavily.
