# ARMADA M.1 — Presentation outline (6 slides)

*Last updated: 15 Oct 2026 — themes, cargo / passenger / sales desks, master Goods & Customers, profile CSV, New-stop popup.*

Full speaking copy and print flyers: [English promo pack](./ARMADA-M1-Promo-EN.md) · [Bahasa Indonesia](./ARMADA-M1-Promo-ID.md).

Use for flyer decks, sales/demo, or internal rollout. Pair with Mermaid from the chat flow pack or `docs/ARMADA-M1-User-Guide.md`. Suggested timing: ~6–8 minutes.

---

## Slide 1 — Title

**Headline:** ARMADA M.1  
**Subhead:** Dispatch & Maintenance — plan, execute, close  
**Visual:** Product wordmark + two icons (truck route / wrench)  
**Footer:** One platform · Desk + Field + Manager · Warm / Mono / Modern themes  

**Speaker note:** Position as operational execution on top of Armada fleet tracking — not another GPS map, but the work layer. UI themes stay optional; Modern is the cool teal ops look.

---

## Slide 2 — Who & where

**Headline:** Three surfaces, clear roles  

| Role | URL | Job |
|------|-----|-----|
| Ops / dispatcher | `/jobs` | Plan deliveries / visits / rides |
| Goods & customers | `/goods` · `/customers` | Catalog, stock, delivery points |
| Maintenance desk | `/maintenance` | Schedule service |
| Field | `/m` | Do the work |
| Manager | `/mm` | Approve & lock |

**Visual:** Simple role cards  
**One line:** *Desk plans. Field executes. Manager closes the loop (Maintenance).*

**Speaker note:** Entitlements per tenant; Field can have both tabs. Desk mode switches Cargo · Passenger · Sales when those modules are on.

---

## Slide 3 — Dispatch story

**Headline:** Plan the day. Assign the run. Deliver with proof.  

**Flow (horizontal):**  
Inbox orders → Job on vehicle → Assign driver (WhatsApp) → START / FINISH stops → Complete job  

**Bullets (max 6):**
- Three desks: **Cargo**, **Passenger**, **Sales** (same Jobs board, profile-aware inbox)  
- Orders: map pin · **New-stop popup** · CSV (cargo / passenger / sales) · routines · carry-over  
- Goods & Customers master pages · depot stock · truck day-close · opex / fare rates  
- Auto-plan (CVRP) or manual assign · capacity / seats aware  
- Scan cargo · print QR / desk NFC · Live board (status, money, sales outcomes)  
- GPS + optional POD · WhatsApp assign / fare / goods copy  

**Visual:** Mermaid happy-path or 5-step strip + optional Goods desk screenshot (Modern theme)  

**Speaker note:** Demo path: Modern theme → add stop in popup → or import passenger/sales CSV → assign → FINISH on `/m`.

---

## Slide 4 — Maintenance story

**Headline:** Schedule the service. Tech executes. Manager locks it.  

**Flow (horizontal):**  
Create due → Assign tech (WhatsApp) → Start → Done → Approve  

**Bullets (max 5):**
- Schedule by date / km / hours  
- Parts catalog: SKU, print QR / NFC, on-hand  
- Field scan parts · optional serial · optional require scan before Done  
- Next cycle after Done · reminders  
- Done waits for manager Approve  

**Visual:** Status pills: due → in_progress → done → approved  

**Speaker note:** Contrast with Dispatch: Maintenance is not “done” until manager Approve. Scan never auto-completes.

---

## Slide 5 — Side by side

**Headline:** Same field app, two kinds of work  

| | Dispatch | Maintenance |
|--|----------|-------------|
| Unit | Job + stops (cargo / passenger / sales) | Service event |
| Done means | Driver finished route / visit | Tech finished; await Approve |
| Scan | Cargo add / confirm / serial · vehicle · depot | Part add / serial · vehicle · require before Done |
| Labels | Print QR · desk NFC | Same on parts |
| Repeat | Routine templates | Spawn next due |
| Incomplete | Skip / reschedule | Skip / reopen |
| Notify | On assign · fare / goods WhatsApp | Assign + schedule reminders |

**Visual:** Two-column comparison (keep text large; cut rows if printing as flyer)  

**Speaker note:** One scan switchboard per Field role; camera / type / NFC (APK) share one catalog.

---

## Slide 6 — Call to action / rollout

**Headline:** Go live checklist  

**Left — Enable**
- Tenant modules + mobile entitlements (cargo / passenger / sales as needed)  
- Field users + WhatsApp phones  
- Wablas + `PUBLIC_BASE_URL`  

**Right — First week**
1. Dispatch: 1 depot, 2 capacities, 5 orders (or 1 sales / passenger CSV), 1 job  
2. Maintenance: 1 scheduled job, assign, Done, Approve  
3. Confirm WhatsApp on assign  

**Closing line:** *ARMADA M.1 — from plan to proof.*  

**Optional QR / URL:** Field `/m?k=…` · Desk `/jobs` · `/goods` · `/customers` · `/maintenance`

---

## Flyer variant (1 page)

If collapsing to a single flyer, use:

1. **Title + one-liners** (slides 1 + headlines 3–4)  
2. **Role strip** (slide 2 table, condensed)  
3. **Two flow ribbons** (Dispatch + Maintenance)  
4. **CTA checklist** (slide 6, three bullets only)

---

## Asset checklist for design

- [ ] Logo / wordmark ARMADA M.1  
- [ ] Screenshot: `/jobs` board (map + inbox; New-stop popup) — prefer **Modern** theme  
- [ ] Screenshot: `/goods` master desk (catalog + stock)  
- [ ] Screenshot: goods/parts Print QR or Field Scan cargo  
- [ ] Screenshot: `/m` Dispatch job + FINISH (cargo or passenger / sales visit)  
- [ ] Screenshot: `/m` Maintenance Start/Done  
- [ ] Screenshot: `/mm` Approve  
- [ ] Mermaid → PNG via [mermaid.live](https://mermaid.live) for slides 3–4  
- [ ] Avoid dense tables on printed flyer; keep comparison for digital slide 5  

*Aligned with `docs/ARMADA-M1-User-Guide.md` and `docs/ARMADA-M1-Scan-Phases.md`.*
