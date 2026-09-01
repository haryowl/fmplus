# FM Plus — vehicle metrics

Armada embed dashboard for distance, utilization, fuel, terrain, road, and fleet comparison.

## Install from git

```bash
git clone https://github.com/haryowl/fmplus.git && cd fmplus && npm install && cp .env.example .env.local
```

Edit `.env.local` and set `ARMADA_AUTH_HEADER` (server-side only — do not prefix with `VITE_`). Then:

```bash
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/).

| Page | URL |
| --- | --- |
| Full dashboard | `/` |
| Compact (one screen) | `/compact` |
| Fleet comparison | `/fleet` |
| Fleet ranking | `/fleet/compact` |

Embed query: `groupId`, `userId`, `userIds`, `from`, `to`, `tz`, `period`, `embed=1`.
