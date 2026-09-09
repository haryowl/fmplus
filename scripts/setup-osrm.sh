#!/usr/bin/env bash
# Build OSRM graph data and (optionally) start the routed container.
# Run on the Linux VPS (or any Docker host with enough disk/RAM).
#
# Usage:
#   chmod +x scripts/setup-osrm.sh
#   ./scripts/setup-osrm.sh                  # Indonesia extract (large)
#   PBF_URL=https://download.geofabrik.de/asia/indonesia/java-latest.osm.pbf ./scripts/setup-osrm.sh
#   ./scripts/setup-osrm.sh --start-only     # start routed from existing data
#
# Then in FM Plus .env.local:
#   OSRM_BASE_URL=http://127.0.0.1:5000
#   systemctl restart fmplus
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${OSRM_DATA_DIR:-$ROOT/data/osrm}"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"
# Full Indonesia is ~1GB+ PBF and needs several GB RAM to extract. Prefer a smaller region when possible.
PBF_URL="${PBF_URL:-https://download.geofabrik.de/asia/indonesia-latest.osm.pbf}"
START_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --start-only) START_ONLY=1 ;;
    -h|--help)
      sed -n '1,20p' "$0"
      exit 0
      ;;
  esac
done

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

PBF_NAME="$(basename "$PBF_URL")"
BASE_NAME="${PBF_NAME%.osm.pbf}"
BASE_NAME="${BASE_NAME%.pbf}"

if [[ "$START_ONLY" -eq 0 ]]; then
  if [[ ! -f "$PBF_NAME" ]]; then
    echo "==> Downloading $PBF_URL"
    curl -L --fail -o "$PBF_NAME" "$PBF_URL"
  else
    echo "==> Using existing $DATA_DIR/$PBF_NAME"
  fi

  echo "==> osrm-extract (slow; needs RAM — Indonesia often wants 8GB+)"
  docker run --rm -t -v "$DATA_DIR:/data" "$IMAGE" \
    osrm-extract -p /opt/car.lua "/data/$PBF_NAME"

  echo "==> osrm-partition"
  docker run --rm -t -v "$DATA_DIR:/data" "$IMAGE" \
    osrm-partition "/data/${BASE_NAME}.osrm"

  echo "==> osrm-customize"
  docker run --rm -t -v "$DATA_DIR:/data" "$IMAGE" \
    osrm-customize "/data/${BASE_NAME}.osrm"
fi

if [[ ! -f "${BASE_NAME}.osrm" && ! -f "${BASE_NAME}.osrm.cell_metrics" && ! -f "${BASE_NAME}.osrm.mldgr" ]]; then
  # .osrm is a basename for a file set; check for a common companion
  if ! ls "${BASE_NAME}.osrm"* >/dev/null 2>&1; then
    echo "No OSRM graph files for $BASE_NAME in $DATA_DIR — run without --start-only first."
    exit 1
  fi
fi

echo "==> Starting osrm-routed on host port 5000"
docker rm -f fmplus-osrm 2>/dev/null || true
docker run -d --name fmplus-osrm --restart unless-stopped \
  -p 5000:5000 \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  osrm-routed --algorithm mld "/data/${BASE_NAME}.osrm"

echo "==> Smoke test"
sleep 2
curl -fsS "http://127.0.0.1:5000/route/v1/driving/106.8272,-6.1754;106.8456,-6.2088?overview=false" | head -c 200
echo
echo
echo "OK. Add to FM Plus .env.local:"
echo "  OSRM_BASE_URL=http://127.0.0.1:5000"
echo "Then: systemctl restart fmplus"
echo "Route plan page should show engine OSRM after refresh."
