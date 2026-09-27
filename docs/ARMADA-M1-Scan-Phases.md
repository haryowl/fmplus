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

## Phase 2 — NFC read (not built)

- Same lookup. One “Scan or tap” control
- APK only; phones without NFC still use the camera

## Phase 3 — Desk print + NFC write (print QR is in Phase 0; write is not built)

- Write NFC tag at the desk only, same `am1:v1:…` string
- Field does not write tags

## Phase 4 — Serial / lot

- Scan can mean “this unit,” not “+1 of this SKU”
- Fill `serial` / `lot` on the line; pickup vs drop can require the same serial

## Phase 5 — Wider targets

- Vehicle tag → open the right maintenance job or confirm the plate
- Bin / depot tag → default zone or depot
- Expected-vs-scanned checklist on a stop

## Not a phase until inventory is sold

On-hand qty, reservations, cycle count. Hang them on `catalog_codes` later.

## Out of scope

- NFC write on the driver phone
- Scan to complete a stop or a service job
- Auto-creating catalog items from unknown codes
- Scanning Service / Other rows as the primary path
