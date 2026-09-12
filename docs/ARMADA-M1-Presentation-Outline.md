# ARMADA M.1 — Presentation outline (6 slides)

Use for flyer decks, sales/demo, or internal rollout. Pair with Mermaid from the chat flow pack or `docs/ARMADA-M1-User-Guide.md`. Suggested timing: ~6–8 minutes.

---

## Slide 1 — Title

**Headline:** ARMADA M.1  
**Subhead:** Dispatch & Maintenance — plan, execute, close  
**Visual:** Product wordmark + two icons (truck route / wrench)  
**Footer:** One platform · Desk + Field + Manager  

**Speaker note:** Position as operational execution on top of Armada fleet tracking — not another GPS map, but the work layer.

---

## Slide 2 — Who & where

**Headline:** Three surfaces, clear roles  

| Role | URL | Job |
|------|-----|-----|
| Ops / dispatcher | `/jobs` | Plan deliveries |
| Maintenance desk | `/maintenance` | Schedule service |
| Field | `/m` | Do the work |
| Manager | `/mm` | Approve & lock |

**Visual:** Simple 2×2 role cards  
**One line:** *Desk plans. Field executes. Manager closes the loop (Maintenance).*

**Speaker note:** Entitlements per tenant; field can have both tabs.

---

## Slide 3 — Dispatch story

**Headline:** Plan the day. Assign the run. Deliver with proof.  

**Flow (horizontal):**  
Inbox orders → Job on vehicle → Assign driver (WhatsApp) → START / FINISH stops → Complete job  

**Bullets (max 4):**
- Orders pool by date · routines · carry-over  
- Auto-plan (CVRP) or manual assign  
- GPS + optional POD photo per stop  
- Skip / reschedule keeps the same order for another day  

**Visual:** Mermaid happy-path or 5-step strip  

**Speaker note:** Demo path: create stop → assign to job → show WhatsApp → open `/m` → FINISH one stop.

---

## Slide 4 — Maintenance story

**Headline:** Schedule the service. Tech executes. Manager locks it.  

**Flow (horizontal):**  
Create due → Assign tech (WhatsApp) → Start → Done → Approve  

**Bullets (max 4):**
- Schedule by date / km / hours  
- Parts, labor, photos, odometer on the job  
- Next cycle auto-created after Done  
- Reminders: due soon / overdue / next due  

**Visual:** Status pills: due → in_progress → done → approved  

**Speaker note:** Contrast with Dispatch: Maintenance is not “done” until manager Approve.

---

## Slide 5 — Side by side

**Headline:** Same field app, two kinds of work  

| | Dispatch | Maintenance |
|--|----------|-------------|
| Unit | Job + stops | Service event |
| Done means | Driver finished route | Tech finished; await Approve |
| Repeat | Routine templates | Spawn next due |
| Incomplete | Skip / reschedule | Skip / reopen |
| Notify | On assign | Assign + schedule reminders |

**Visual:** Two-column comparison (keep text large; cut rows if printing as flyer)  

**Speaker note:** Customers often buy both; field staff switch tabs on `/m`.

---

## Slide 6 — Call to action / rollout

**Headline:** Go live checklist  

**Left — Enable**
- Tenant modules + mobile entitlements  
- Field users + WhatsApp phones  
- Wablas + `PUBLIC_BASE_URL`  

**Right — First week**
1. Dispatch: 1 depot, 2 capacities, 5 orders, 1 job  
2. Maintenance: 1 scheduled job, assign, Done, Approve  
3. Confirm WhatsApp on assign  

**Closing line:** *ARMADA M.1 — from plan to proof.*  

**Optional QR / URL:** Field `/m?k=…` · Desk `/jobs` · `/maintenance`

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
- [ ] Screenshot: `/jobs` board (map + inbox)  
- [ ] Screenshot: `/m` Dispatch job + FINISH  
- [ ] Screenshot: `/m` Maintenance Start/Done  
- [ ] Screenshot: `/mm` Approve  
- [ ] Mermaid → PNG via [mermaid.live](https://mermaid.live) for slides 3–4  
- [ ] Avoid dense tables on printed flyer; keep comparison for digital slide 5  

*Aligned with `docs/ARMADA-M1-User-Guide.md`.*
