# OSRM profiles (FM Plus)

`car-fmplus.lua` is **generated** (not committed) by:

```bash
node scripts/build-osrm-fmplus-profile.mjs
```

It wraps stock `car.lua` and marks Jakarta ganjil–genap corridors with excludable class `ganjilgenap` (OSRM allows `[a-Z0-9]` only). Name match list from `server/data/jakarta-ganjil-genap.json`, or OSM tag `jakarta:ganjil_genap=yes`.

See `docs/osrm.md` for extract / restart steps.
