#!/usr/bin/env bash
# Build OSRM graph data and (optionally) start the routed container.
# Run on the Linux VPS (or any Docker host with enough disk/RAM).
#
# Usage:
#   chmod +x scripts/setup-osrm.sh
#
#   # Recommended for FM Plus fleets on the four major islands:
#   ./scripts/setup-osrm.sh --regions=java,sumatra,kalimantan,sulawesi
#
#   # If GHCR osmium is denied, the script uses Docker Hub iboates/osmium or apt osmium-tool.
#   # Single Geofabrik extract (legacy):
#   PBF_URL=https://download.geofabrik.de/asia/indonesia/sulawesi-latest.osm.pbf ./scripts/setup-osrm.sh
#   PBF_URL=https://download.geofabrik.de/asia/indonesia-latest.osm.pbf ./scripts/setup-osrm.sh
#
#   ./scripts/setup-osrm.sh --start-only
#   OSRM_GRAPH=id-java-sumatra-kalimantan-sulawesi ./scripts/setup-osrm.sh --start-only
#
# Then in FM Plus .env.local:
#   OSRM_BASE_URL=http://127.0.0.1:5000
#   systemctl restart fmplus
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${OSRM_DATA_DIR:-$ROOT/data/osrm}"
IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"
# GHCR osmcode image often returns "denied" without auth — prefer Docker Hub.
OSMIUM_IMAGE="${OSMIUM_IMAGE:-iboates/osmium:latest}"
# Full Indonesia is ~1GB+ PBF and needs several GB RAM to extract.
PBF_URL="${PBF_URL:-https://download.geofabrik.de/asia/indonesia-latest.osm.pbf}"
REGIONS="${REGIONS:-}"
START_ONLY=0
GEOFABRIK_BASE="https://download.geofabrik.de/asia/indonesia"

# Geofabrik uses English island names in paths (sumatra, not sumatera).
declare -A REGION_URL=(
  [java]="$GEOFABRIK_BASE/java-latest.osm.pbf"
  [sumatra]="$GEOFABRIK_BASE/sumatra-latest.osm.pbf"
  [sumatera]="$GEOFABRIK_BASE/sumatra-latest.osm.pbf"
  [kalimantan]="$GEOFABRIK_BASE/kalimantan-latest.osm.pbf"
  [sulawesi]="$GEOFABRIK_BASE/sulawesi-latest.osm.pbf"
  [papua]="$GEOFABRIK_BASE/papua-latest.osm.pbf"
  [maluku]="$GEOFABRIK_BASE/maluku-latest.osm.pbf"
  [nusa-tenggara]="$GEOFABRIK_BASE/nusa-tenggara-latest.osm.pbf"
)

for arg in "$@"; do
  case "$arg" in
    --start-only) START_ONLY=1 ;;
    --regions=*)
      REGIONS="${arg#--regions=}"
      ;;
    --regions)
      echo "Use --regions=java,sumatra,kalimantan,sulawesi"
      exit 1
      ;;
    -h|--help)
      sed -n '1,28p' "$0"
      exit 0
      ;;
  esac
done

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

download_pbf() {
  local url="$1"
  local name
  name="$(basename "$url")"
  if [[ ! -f "$name" ]]; then
    echo "==> Downloading $url"
    curl -L --fail -o "$name" "$url"
  else
    echo "==> Using existing $DATA_DIR/$name"
  fi
  echo "$name"
}

build_graph() {
  local pbf_name="$1"
  local base_name="$2"

  echo "==> osrm-extract on $pbf_name (slow; multi-island often wants 8GB+ RAM)"
  docker run --rm -t -v "$DATA_DIR:/data" "$IMAGE" \
    osrm-extract -p /opt/car.lua "/data/$pbf_name"

  echo "==> osrm-partition"
  docker run --rm -t -v "$DATA_DIR:/data" "$IMAGE" \
    osrm-partition "/data/${base_name}.osrm"

  echo "==> osrm-customize"
  docker run --rm -t -v "$DATA_DIR:/data" "$IMAGE" \
    osrm-customize "/data/${base_name}.osrm"
}

# Merge several .osm.pbf files. Tries host osmium, then Docker Hub image, then apt.
merge_pbfs() {
  local out_name="$1"
  shift
  local inputs=("$@")
  local data_args=()
  local host_args=()
  local f

  for f in "${inputs[@]}"; do
    data_args+=("/data/$f")
    host_args+=("$DATA_DIR/$f")
  done

  rm -f "$DATA_DIR/$out_name"

  if command -v osmium >/dev/null 2>&1; then
    echo "==> Merging with host osmium → $out_name"
    osmium merge "${host_args[@]}" -o "$DATA_DIR/$out_name" --overwrite
    return 0
  fi

  echo "==> Merging with Docker osmium ($OSMIUM_IMAGE) → $out_name"
  # iboates/osmium ENTRYPOINT is already `osmium`, so pass `merge` only.
  if docker run --rm -t -v "$DATA_DIR:/data" "$OSMIUM_IMAGE" \
      merge "${data_args[@]}" -o "/data/$out_name" --overwrite; then
    return 0
  fi

  echo "==> Docker osmium failed — trying apt install osmium-tool"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq osmium-tool
    osmium merge "${host_args[@]}" -o "$DATA_DIR/$out_name" --overwrite
    return 0
  fi

  echo "Could not merge PBFs (no osmium). Install: apt-get install -y osmium-tool"
  echo "Or set OSMIUM_IMAGE to a pullable image and retry."
  exit 1
}

BASE_NAME=""
PBF_NAME=""

if [[ "$START_ONLY" -eq 0 ]]; then
  if [[ -n "$REGIONS" ]]; then
    IFS=',' read -r -a region_list <<< "$REGIONS"
    pbf_files=()
    label_parts=()
    for raw in "${region_list[@]}"; do
      key="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
      url="${REGION_URL[$key]:-}"
      if [[ -z "$url" ]]; then
        echo "Unknown region '$key'. Known: java sumatra/sumatera kalimantan sulawesi papua maluku nusa-tenggara"
        exit 1
      fi
      # Canonical label in output name (sumatera → sumatra)
      case "$key" in
        sumatera) label_parts+=("sumatra") ;;
        *) label_parts+=("$key") ;;
      esac
      pbf_files+=("$(download_pbf "$url")")
    done

    BASE_NAME="id-$(IFS=-; echo "${label_parts[*]}")"
    PBF_NAME="${BASE_NAME}.osm.pbf"

    if [[ ${#pbf_files[@]} -eq 1 ]]; then
      # Single region — use the downloaded file basename for OSRM.
      PBF_NAME="${pbf_files[0]}"
      BASE_NAME="${PBF_NAME%.osm.pbf}"
      BASE_NAME="${BASE_NAME%.pbf}"
    else
      echo "==> Merging ${#pbf_files[@]} extracts → $PBF_NAME"
      merge_pbfs "$PBF_NAME" "${pbf_files[@]}"
    fi

    build_graph "$PBF_NAME" "$BASE_NAME"
  else
    PBF_NAME="$(basename "$PBF_URL")"
    BASE_NAME="${PBF_NAME%.osm.pbf}"
    BASE_NAME="${BASE_NAME%.pbf}"
    download_pbf "$PBF_URL" >/dev/null
    build_graph "$PBF_NAME" "$BASE_NAME"
  fi
else
  # Prefer explicit graph name, else try the multi-island default, else derive from PBF_URL.
  if [[ -n "${OSRM_GRAPH:-}" ]]; then
    BASE_NAME="$OSRM_GRAPH"
  elif ls id-java-sumatra-kalimantan-sulawesi.osrm* >/dev/null 2>&1; then
    BASE_NAME="id-java-sumatra-kalimantan-sulawesi"
  else
    PBF_NAME="$(basename "$PBF_URL")"
    BASE_NAME="${PBF_NAME%.osm.pbf}"
    BASE_NAME="${BASE_NAME%.pbf}"
  fi
fi

if ! ls "${BASE_NAME}.osrm"* >/dev/null 2>&1; then
  echo "No OSRM graph files for $BASE_NAME in $DATA_DIR — run without --start-only first."
  exit 1
fi

echo "==> Starting osrm-routed on host port 5000 (graph: $BASE_NAME)"
docker rm -f fmplus-osrm 2>/dev/null || true
docker run -d --name fmplus-osrm --restart unless-stopped \
  -p 5000:5000 \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  osrm-routed --algorithm mld "/data/${BASE_NAME}.osrm"

echo "==> Smoke tests"
sleep 2
echo -n "Java (Jakarta): "
curl -fsS "http://127.0.0.1:5000/route/v1/driving/106.8272,-6.1754;106.8456,-6.2088?overview=false" | head -c 120 || true
echo
echo -n "Sulawesi (Kendari area sample): "
curl -fsS "http://127.0.0.1:5000/route/v1/driving/122.5149,-3.9778;122.5900,-3.9500?overview=false" | head -c 120 || true
echo
echo
echo "OK. Graph basename: $BASE_NAME"
echo "Add to FM Plus .env.local:"
echo "  OSRM_BASE_URL=http://127.0.0.1:5000"
echo "Then: systemctl restart fmplus"
echo
echo "Compose alternative:"
echo "  OSRM_GRAPH=$BASE_NAME docker compose --profile osrm up -d osrm"
