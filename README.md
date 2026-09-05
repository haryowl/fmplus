# FM Plus — vehicle metrics

Armada embed dashboard for distance, utilization, fuel, terrain, road, and fleet comparison.

Requires **Node.js 20.19+ or 22** (Vite 8). Node 18 will fail with `styleText` from `node:util`.

## Install from git

```bash
git clone https://github.com/haryowl/fmplus.git && cd fmplus && npm install && cp .env.example .env.local
```

Edit `.env.local` and set `ARMADA_AUTH_HEADER` (server-side only — do not prefix with `VITE_`). Then:

```bash
npm run dev
```

On a server, use Node 22, then **reinstall modules** (a Node 18 `npm install` will not include the Linux Rolldown binary), then build:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
node -v
rm -rf node_modules
npm install
npm run build && npm start
```

Open [http://localhost:5173/](http://localhost:5173/) for `npm run dev`, or port **4173** for `npm start`.

## Run always on Linux

Use **systemd**, not `npm run dev`. Build once, then let `node server.mjs` restart on crash and at boot.

```bash
cd /root/fmplus/fmplus
npm run build
cp deploy/fmplus.service /etc/systemd/system/fmplus.service
systemctl daemon-reload
systemctl enable --now fmplus
systemctl status fmplus
```

Useful commands:

```bash
systemctl restart fmplus
journalctl -u fmplus -f
```

If you copied the unit by hand before `git pull`, install it from this file after pulling. The app listens on port **4173**. If `ssl/server.key` and `ssl/server.crt` are present (do not commit them), `npm start` serves HTTPS.

Open [http://localhost:5173/](http://localhost:5173/).

| Page | URL |
| --- | --- |
| Full dashboard | `/` |
| Compact (one screen) | `/compact` |
| Fleet comparison | `/fleet` |
| Fleet ranking | `/fleet/compact` |

Embed query: `k`, `appId`, `groupId`, `userId`, `userIds`, `from`, `to`, `tz`, `period`, `embed=1`.

## Multi-operator embed

`http://81.17.100.7:4173/` with **no** `k` is the standalone app: `ARMADA_AUTH_HEADER` and **app 36** only.

Any other GpsGate application (37, 40, …) needs a row in server-side `tenants.json` (copy `tenants.example.json`; gitignored). The token is per operator/app, so **`userIds` and `groupIds` are optional**.

### Browse an app and read the real IDs

Leave the allowlists out. Open the Full page with only `k` and `appId`. Group and vehicle dropdowns list everything that token can see, and each option ends with the numeric id.

```json
{
  "emb_app37_browse": {
    "appId": 37,
    "token": "v2:app-37-token"
  }
}
```

```
http://81.17.100.7:4173/?k=emb_app37_browse&appId=37
```

Restart after editing the file (`systemctl restart fmplus`) — tenants are loaded once at process start.

### Lock the iframe later (optional)

When you know the ids, add `userIds` / `groupIds` and put them on the URL. Changing `userId` in the URL cannot open another operator’s vehicles.

```
http://81.17.100.7:4173/?embed=1&k=emb_siteA_locked&appId=40&groupId=12&userId=99
```

Parents may be several hosts. Default iframe + `postMessage` allowlist is `https://armada.id` and `https://*.armada.id` (apex plus any subdomain). Override with `EMBED_FRAME_ANCESTORS` and `VITE_EMBED_ORIGINS` if needed.

## Infra foundation (Postgres + object storage)

Roadmap baseline for Admin / Maintenance / Dispatch. Optional today — without `DATABASE_URL` the app still uses `tenants.json` / `ARMADA_AUTH_HEADER` as before.

```bash
npm run db:up          # Postgres :5432 + MinIO :9000 (console :9001)
# Add to .env.local (see .env.example):
#   DATABASE_URL=postgres://fmplus:fmplus@127.0.0.1:5433/fmplus
#   FMS_SECRETS_KEY=...long random...
#   S3_ENDPOINT=http://127.0.0.1:9000
#   S3_ACCESS_KEY=fmplus
#   S3_SECRET_KEY=fmplussecret
#   S3_BUCKET=fmplus-pom
#   S3_FORCE_PATH_STYLE=1
npm run db:migrate
npm run probe:armada   # writes docs/armada-api-probe.md (no tokens in the file)
```

Health check: `GET /api/health` (database / secrets key / object storage status).

Tenant load order: `tenants.json` → `TENANTS_JSON` → default `ARMADA_AUTH_HEADER` → **Postgres overlay** (same `k` wins from DB when enabled).

## Admin console

Open `/admin` after Postgres + `FMS_SECRETS_KEY` are configured.

1. Set bootstrap credentials once in `.env.local`:
   ```
   ADMIN_BOOTSTRAP_USER=admin
   ADMIN_BOOTSTRAP_PASSWORD=change-me-now
   ```
2. Restart the app (`npm run dev` or `systemctl restart fmplus`). The first admin is created only when `admin_users` is empty.
3. Sign in at `/admin`, create tenants (embed `k`, appId, Armada token, webhook secret, module visibility).
4. Armada tokens are encrypted at rest and **never** returned to the browser.
5. Per tenant, add **field users** (operator / driver / dispatcher) for `/m` and `/dispatch` login.
6. Set a **webhook secret** on the tenant, then copy the Exception / Maintenance notifier URLs into Armada Command notifier.

Optional: set `PUBLIC_BASE_URL=https://81.17.100.7:4173` so Admin shows absolute notifier URLs.

## Field login

Open `/m` (or `/dispatch`) with the tenant embed key:

```
https://81.17.100.7:4173/m?k=YOUR_TENANT_KEY
```

Sign in with a field user created in Admin. Jobs / PoM come in later phases — login only for now.

## Armada Command notifier (Phase B0)

1. In Admin, set **Webhook secret** on the tenant and Save.
2. Copy the Exception or Maintenance URL (replace `<webhook-secret>` with the real secret).
3. In Armada: Event Rule / Maintenance Schedule → Command → Custom Server → HTTP GET to that URL (GpsGate appends `RULE_NAME`, `EVENT_TIME`, `USER_*`, `POS_*`, …).
4. FM Plus responds plain text **`OK`**. Events are stored in Postgres (`armada_notifications`) for Exceptions / Maintenance UI later.

Smoke test:

```bash
curl -sk "https://81.17.100.7:4173/api/armada/notify?k=YOUR_K&secret=YOUR_SECRET&kind=exception&RULE_NAME=Test&EVENT_TIME=2026-09-05T12:00:00Z&USER_USERNAME=demo"
# → OK
```

Bad secret returns `401` (no `OK`) so misconfiguration is visible in Armada.
