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

Each operator gets an opaque key `k` (not the GpsGate token). The iframe URL may include public `appId` plus vehicle/group ids. Tokens stay in server-side `tenants.json` (copy `tenants.example.json`; the real file is gitignored).

```
http://81.17.100.7:4173/?embed=1&k=emb_siteA_x7k2&appId=40&groupId=12&userId=99
```

Changing `userId` in that URL cannot open another operator’s vehicles. The server maps `k` → token, app, and allowed ids, then 403s other apps/users/groups.

Parents may be several hosts. Default iframe + `postMessage` allowlist is `https://armada.id` and `https://*.armada.id` (apex plus any subdomain). Override with `EMBED_FRAME_ANCESTORS` and `VITE_EMBED_ORIGINS` if needed.
