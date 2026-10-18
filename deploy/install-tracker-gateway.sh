#!/usr/bin/env bash
# Install Go (if needed), build tracker-gateway, and enable systemd unit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GW="$ROOT/tracker-gateway"

if ! command -v go >/dev/null 2>&1; then
  echo "Go not found — installing golang-go via apt..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y golang-go
fi

echo "go: $(go version)"
mkdir -p "$GW/bin"
cd "$GW"
CGO_ENABLED=0 go build -o bin/tracker-gateway .

cp "$ROOT/deploy/tracker-gateway.service" /etc/systemd/system/tracker-gateway.service
systemctl daemon-reload
systemctl enable --now tracker-gateway
systemctl --no-pager --full status tracker-gateway || true
sleep 1
curl -sS -m 3 http://127.0.0.1:5080/healthz || {
  echo "healthz failed — check: journalctl -u tracker-gateway -n 80 --no-pager"
  echo "Ensure DATABASE_URL is set in $ROOT/.env.local"
  exit 1
}
echo "tracker-gateway OK"
