# ARMADA M.1 — User Guide

**Dispatch** and **Maintenance** modules for planning, field execution, and close-out.

Use this with the flow diagrams in the product canvas / Mermaid pack. Tenant access always uses the embed key (`?k=`).

---

## 1. Who uses what

| Role | Where | Dispatch | Maintenance |
|------|--------|----------|-------------|
| Dispatcher / ops | `/jobs` | Plan day, orders, jobs, assign driver | — |
| Maintenance desk | `/maintenance` | — | Create jobs, assign tech, schedule, costs |
| Field user | `/m` | Run assigned jobs, START/FINISH stops | Start → work → Done, photos, parts |
| Manager | `/mm` | — | Assign follow-ups, **Approve** Done jobs |

Field phone (`/m`) can show both **Maintenance** and **Dispatch** tabs when both mobile entitlements are enabled. Managers sign in at `/mm`, not `/m`.

---

## 2. Dispatch

### What it is

Plan delivery/pickup **orders** for a date, load them onto vehicle **jobs**, assign a driver, and execute stop-by-stop on the phone with GPS and optional proof photos.

**One-liner:** *Plan the day. Assign the run. Deliver with proof.*

### Desk (`/jobs`) — daily workflow

1. **Choose plan date** — everything (inbox, jobs) is scoped to that service date.
2. **Build the inbox**
   - Pin the map or pick a POI / street search → **New stop** form → **Add to pool**.
   - Optional: **Generate routines** from templates (daily / Mon–Fri / weekly).
   - Optional: **Carry over** leftover pending orders to the next day.
3. **Create a job** — title, Armada vehicle, capacity (m³ / kg), optional field assignee.
4. **Assign orders to the job** — selected inbox orders become stops on the job (capacity-aware).
5. **Assign / change driver** — triggers **WhatsApp** to the driver’s phone (and tenant notify numbers if configured).
6. Optional: optimize stop sequence, set route start/end, cancel a job (orders return to inbox).

**Auto-plan day:** CVRP planner can preview then apply routes across open jobs and/or capacity presets (fleet + depot settings).

### Field (`/m` → Dispatch)

1. Open an assigned job (see capacity and order list).
2. **Start route** → job becomes *en route*.
3. For each order:
   - Navigate → **START** (arrive) → work → **FINISH** (complete).
   - Phone GPS and Armada GPS are stored.
   - If **proof photo required**, add a photo before FINISH.
4. **Skip / Reschedule** if needed — reason + new date; the same order moves back to *pending* on that date.
5. When no open stops remain → **Complete job**.

### Status cheat sheet

| Object | Statuses | Meaning |
|--------|----------|---------|
| **Job** | draft → assigned → en_route → (arrived) → done · cancelled | Desk plans; driver runs; cancel releases orders |
| **Stop** | pending → arrived → done · skipped | One delivery/pickup on the route |
| **Order** | pending · assigned · cancelled | Inbox vs on a job |

### WhatsApp (Dispatch)

Sent when a job is **newly assigned** or **reassigned** to a field user. Message includes job title, date, vehicle, stop count, and a link to `/m`. Requires Wablas on the tenant and a phone on the field user.

---

## 3. Maintenance

### What it is

Schedule and execute **service events** on vehicles: assign a technician, capture work (notes, odometer, parts, photos), then have a manager **approve** the completed job. Schedules can auto-create the next due cycle.

**One-liner:** *Schedule the service. Tech executes. Manager locks it.*

### Desk (`/maintenance`) — workflow

1. **Create** a service event on a vehicle (title, notes, optional schedule: due date / day / km / hours intervals and “before” windows).
2. **Assign** a field technician → **WhatsApp** / platform notify.
3. Monitor boards: attention, upcoming, due, overdue, completed.
4. After field **Done**, review costs/lines; managers approve on `/mm` (desk can also manage lifecycle per permissions).
5. Use **Evaluate reminders** when you want due_soon / overdue fan-out (WhatsApp, email, inbox).

### Field (`/m` → Maintenance)

1. Open an assigned job.
2. **Start** → *in progress* (timer).
3. Enter notes, odometer, catalog lines (parts / service / labor), photos. Draft can be kept locally on the device.
4. **Done** → *done*. If a schedule is configured, the system may **spawn the next due** event (often unassigned until desk/manager assigns).
5. **Skip** abandons without completion (can be reopened to *due*).

### Manager (`/mm`)

1. Review *done* jobs (lines, photos, costs).
2. **Approve** → *approved* (terminal lock).
3. Assign unassigned follow-up / next-cycle jobs.
4. **End series** when the maintenance chain should stop.

### Status cheat sheet

| Status | Meaning |
|--------|---------|
| **due** | Open / waiting to start |
| **in_progress** | Technician started |
| **done** | Tech finished; awaiting approve |
| **skipped** | Abandoned without completion |
| **approved** | Manager locked; terminal |

Allowed moves (summary): Start, Done, Skip, Cancel start (*in_progress* → *due*), Reopen (*done* / *skipped* → *due*). *approved* does not reopen.

### WhatsApp / reminders (Maintenance)

| Kind | When |
|------|------|
| **assigned** | Technician assigned |
| **due_soon** / **overdue** | Schedule evaluate |
| **next_due** | Next cycle event created after Done |

Channels: WhatsApp (Wablas), email (SMTP), platform inbox — same tenant notify settings as Admin.

---

## 4. Quick comparison

| Topic | Dispatch | Maintenance |
|-------|----------|-------------|
| Unit of work | Job + stops (orders) | Service event on vehicle |
| Planner | CVRP auto-plan + manual assign | Schedule intervals |
| Repeat | Routine order templates | Spawn next due on Done |
| Incomplete | Skip / reschedule order | Skip event · reopen |
| Proof | Per-stop POD photo | Event photos |
| “Finished” | Driver **Complete job** | Manager **Approve** |

---

## 5. Setup checklist (ops)

- [ ] Tenant key `k=` on all links  
- [ ] Modules enabled: desk `dispatch` / `maintenance`; mobile `mobile.dispatch` / `mobile.maintenance`; manager maintenance if using `/mm`  
- [ ] Field users have phones (WhatsApp) and correct role  
- [ ] Wablas token/secret (and optional notify WhatsApp list) in Admin  
- [ ] `PUBLIC_BASE_URL` set so WhatsApp links open `/m` correctly  
- [ ] Dispatch: depots, vehicle capacities, POIs as needed  
- [ ] Maintenance: catalog items for parts/labor  

---

## 6. Support notes

- Cancelled **dispatch** jobs return linked orders to the **pending** inbox.  
- Skipped **dispatch** stops keep the **same order id** with a new service date.  
- **Approved** maintenance jobs are locked; fix process is reopen *before* approve, or create a new event.  
- Field managers must use `/mm`, not `/m`.

*Document version aligned with ARMADA M.1 Dispatch + Maintenance flows (product build).*
