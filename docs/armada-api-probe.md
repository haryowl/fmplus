# Armada API probe results

Probed against `armada.id` application **36** on **2026-09-05T14:18:11.984Z**.

Auth and tokens are not recorded in this file.

| Resource | Path | Result | HTTP | Notes |
|----------|------|--------|------|-------|
| geofencegroups | `/geofencegroups?FromIndex=0&PageSize=5` | **YES** | 200 | array n=3 |
| geofences | `/geofences?FromIndex=0&PageSize=5` | **YES** | 200 | array n=0 |
| poicategories | `/poicategories?FromIndex=0&PageSize=5` | **DENIED** | 403 | Forbidden |
| reports | `/reports?FromIndex=0&PageSize=5` | **YES** | 200 | array n=5 |
| reporttemplates | `/reporttemplates?FromIndex=0&PageSize=5` | **YES** | 200 | array n=5 |
| events (no group) | `/events?Date=2026-09-05&FromIndex=0&PageSize=5` | **HTTP_400** | 400 | Either userId or groupId required |
| events?groupId=1 | `/events?Date=2026-09-05&groupId=1&FromIndex=0&PageSize=5` | **NO/404** | 404 | Asset Group with ID 1 was not found |
| reversegeocode (smoke) | `/reversegeocode?lat=-6.175392&lon=106.827153` | **YES** | 200 | keys=geocoderProviderSource,location |

## Interpretation (roadmap)

- **YES** → safe to plan Phase C analytics / Maintenance POI link against this endpoint.
- **DENIED** → token/role missing privilege; fix in Armada before building UI.
- **NO/404** → path not enabled on Armada host or different route; do not depend on it.
- **events?groupId** → if not YES, keep per-user/rule fan-out (current Trip Detail approach).

## Next

- Phase C overlays only where Result is YES.
- Maintenance service-point → Armada POI link depends on **poicategories** (+ pois) YES.

