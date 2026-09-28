# ARMADA M.1 — Catalog scan phases

Barcode, QR, and NFC are three **inputs** for one **code**. A scan resolves through `catalog_codes`. Phase 1 only adds a catalog line. Later phases reuse the same table and lookup.

Printed / NFC payload we write:

`am1:v1:goods:SKU` · `am1:v1:part:SKU`  
later: `am1:v1:vehicle:…` · `am1:v1:location:…`

Bare SKU and factory EAN are also accepted. Do not put tenant keys or server URLs in tags.

---

## Phase 0 — Foundation (this release, desk)

- `catalog_codes` rows: many codes per item (`sku`, `ean`, `qr`, `nfc`, `other`)
- Targets reserved: `goods` · `maint_part` · `vehicle` · `location`
- Maintenance **parts** get a SKU; SKU syncs into `catalog_codes`
- Dispatch goods SKU backfills into `catalog_codes`
- Lookup API: desk + Field
- Catalog UI: extra codes, print QR
- Line columns reserved: `scanned_code`, `serial`, `lot`, `scanned_at` (serial/lot unused until Phase 4)

## Phase 1 — Field scan, add 1 (this release)

- Scan (camera) or type a code next to Add cargo / Add part
- Hit → add line or increment qty; store `scanned_code`
- Miss → “Not in catalog”; never invent an item
- Browser: Barcode Detection API when present, else type the code
- APK: same camera path in the WebView

## Capability switchboard (Phase 1 add + Phase 2 NFC input)

Prepare the **max scan surface**. Admin turns functions on per Field role. Do not put a unique checkbox set on every driver.

Three layers — do not mix them:

| Layer | Meaning | Example |
|---|---|---|
| **Input** | How the phone reads | Camera, type SKU, NFC tap (APK) |
| **Action** | What happens after a hit | Add cargo, confirm expected, open vehicle job |
| **Policy** | How strict the job is | Optional vs required before complete |

Stored on the tenant as `entitlements.scan` (Admin → Entitlements → Field scan by role).

```
scan.inputs: camera · typed · nfc      ← Field enforces now
scan.roles.{operator|driver|dispatcher|manager}:
  cargoAdd · partAdd                    ← Field enforces now
  cargoConfirm · cargoSerial · stopRequireScan
  partSerial · jobRequireScan
  vehicleOpen · locationSet             ← stored, Field ignores until built
```

`/api/field/me` and login return the **resolved** flags for that user’s role. Field /m and Manager /mm hide Scan when the action or every input is off. `/api/field/scan` returns 403 for the same matrix. Desk embed scan is not gated by Field role.

**Shipped defaults** (no regression): every role has `cargoAdd` + `partAdd` on; camera + typed on; all later actions and NFC off. Admin can narrow a delivery-only tenant (driver cargo only) or a workshop tenant (operator parts only) without a new app.

**Recommended later template** (not the shipped default):

| | Driver | Operator | Dispatcher | Manager |
|---|---|---|---|---|
| `cargoAdd` | on | off | off on Field | off on Field |
| `partAdd` | off | on | off | on for /mm |
| `cargoConfirm` / `cargoSerial` / `stopRequireScan` | when built | off | desk | desk |
| `partSerial` / `jobRequireScan` | off | when built | — | — |
| `vehicleOpen` / `locationSet` | when built | when built | — | — |
| NFC write | never | never | desk | desk |

Per-user override is out of scope until a tenant needs a special driver.

`requireScan` must stay off until confirm/serial exists — turning it on with only `add` would force drivers to invent qty by beeping.

## Phase 2 — NFC read (this release, APK)

- Same lookup. One “Scan or tap” control when `scan.inputs.nfc` is on
- APK only (`NfcScan` reader mode). NDEF text first, then chip UID
- Payload is still `am1:v1:goods:SKU` / `am1:v1:part:SKU`, or a UID stored as an extra catalog code
- Phones without NFC, NFC off, or the browser PWA keep camera / type
- Field does not write tags
- Rebuild the Field APK after this release (`npm run apk:sync`)

## Phase 3 — Desk print + NFC write (print QR is in Phase 0; write is not built)

- Write NFC tag at the desk only, same `am1:v1:…` string
- Field does not write tags

## Phase 4 — Serial / lot

- Scan can mean “this unit,” not “+1 of this SKU”
- Fill `serial` / `lot` on the line; pickup vs drop can require the same serial
- Behind `cargoSerial` / `partSerial` (default off)

## Phase 5 — Wider targets

- Vehicle tag → open the right maintenance job or confirm the plate (`vehicleOpen`)
- Bin / depot tag → default zone or depot (`locationSet`)
- Expected-vs-scanned checklist on a stop (`cargoConfirm`, optional `stopRequireScan`)

## Not a phase until inventory is sold

On-hand qty, reservations, cycle count. Hang them on `catalog_codes` later.

## Out of scope

- NFC write on the driver phone
- Scan to complete a stop or a service job
- Auto-creating catalog items from unknown codes
- Scanning Service / Other rows as the primary path
