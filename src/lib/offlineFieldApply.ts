/** Pure snapshot updates for the offline Field app. No network, no IndexedDB. */

export type OfflineSnap = {
  dispatchByDate: Record<string, { jobs: Job[]; serviceDate: string }>;
  events: EventRow[] | null;
  eventDetails: Record<string, EventRow>;
  goods: GoodsItem[] | null;
  catalogGroups: CatalogGroup[] | null;
  calendars: Record<string, unknown>;
  stopPhotos: Record<string, Photo[]>;
  syncedAt: string | null;
};

export type Job = {
  id: string;
  status?: string;
  fieldNote?: string | null;
  armadaUserId?: number | null;
  startedAt?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  stops?: Stop[];
};

export type Stop = {
  id: string;
  orderId?: string | null;
  status?: string;
  notes?: string | null;
  lines?: unknown[];
  startedAt?: string | null;
  completedAt?: string | null;
  startPhoneLat?: number | null;
  startPhoneLon?: number | null;
  completePhoneLat?: number | null;
  completePhoneLon?: number | null;
};

export type EventRow = {
  id: string;
  status?: string;
  notes?: string;
  odometerKm?: number | null;
  lines?: unknown[];
  photos?: Photo[];
  startedAt?: string | null;
  endedAt?: string | null;
  armadaUserId?: number | null;
};

export type GoodsItem = {
  id: string;
  name: string;
  sku?: string;
  enabled?: boolean;
};

export type CatalogGroup = {
  key?: string;
  items?: Array<GoodsItem & { groupKey?: string }>;
};

export type Photo = {
  id: string;
  url: string;
  caption?: string;
  createdAt?: string;
};

export type OfflineHttpResult = {
  status: number;
  json: unknown;
};

export function emptyOfflineSnap(): OfflineSnap {
  return {
    dispatchByDate: {},
    events: null,
    eventDetails: {},
    goods: null,
    catalogGroups: null,
    calendars: {},
    stopPhotos: {},
    syncedAt: null,
  };
}

export function offlineApiPath(raw: string): { path: string; search: string } {
  const text = String(raw || "");
  let pathname = text;
  let search = "";
  try {
    if (/^https?:/i.test(text)) {
      const url = new URL(text);
      pathname = url.pathname;
      search = url.search;
    } else {
      const q = text.indexOf("?");
      pathname = q >= 0 ? text.slice(0, q) : text;
      search = q >= 0 ? text.slice(q) : "";
    }
  } catch {
    /* keep raw */
  }
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  return { path: pathname, search };
}

export function isOfflineFieldWrite(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === "PATCH" && /^\/api\/field\/dispatch\/jobs\/[^/]+$/i.test(path)) return true;
  if (m === "PATCH" && /^\/api\/field\/dispatch\/jobs\/[^/]+\/stops\/[^/]+$/i.test(path)) return true;
  if (m === "PUT" && /^\/api\/field\/dispatch\/orders\/[^/]+\/lines$/i.test(path)) return true;
  if (m === "POST" && /^\/api\/field\/dispatch\/jobs\/[^/]+\/stops\/[^/]+\/photos$/i.test(path)) return true;
  if (m === "PATCH" && /^\/api\/field\/maintenance\/events\/[^/]+$/i.test(path)) return true;
  if (m === "POST" && /^\/api\/field\/maintenance\/events\/[^/]+\/photos$/i.test(path)) return true;
  return false;
}

export function isOfflineFieldGet(method: string, path: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  if (path === "/api/field/dispatch/jobs") return true;
  if (path === "/api/field/dispatch/goods") return true;
  if (path === "/api/field/dispatch/calendar") return true;
  if (path === "/api/field/maintenance/events") return true;
  if (path === "/api/field/maintenance/catalog") return true;
  if (/^\/api\/field\/maintenance\/events\/[^/]+$/i.test(path)) return true;
  if (/^\/api\/field\/dispatch\/jobs\/[^/]+\/stops\/[^/]+\/photos$/i.test(path)) return true;
  return false;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jobsLists(snap: OfflineSnap): Array<{ jobs: Job[]; serviceDate: string }> {
  return Object.values(snap.dispatchByDate);
}

function replaceJob(snap: OfflineSnap, job: Job): OfflineSnap {
  const next = clone(snap);
  for (const list of Object.values(next.dispatchByDate)) {
    list.jobs = list.jobs.map((row) => (row.id === job.id ? job : row));
  }
  return next;
}

function findJob(snap: OfflineSnap, id: string): Job | null {
  for (const list of jobsLists(snap)) {
    const hit = list.jobs.find((row) => row.id === id);
    if (hit) return hit;
  }
  return null;
}

export function rememberOfflineGet(snap: OfflineSnap, pathAndQuery: string, json: unknown, at: string): OfflineSnap {
  const { path, search } = offlineApiPath(pathAndQuery);
  const next = clone(snap);
  next.syncedAt = at;
  const body = json as Record<string, unknown>;
  if (path === "/api/field/dispatch/jobs") {
    const date = new URLSearchParams(search).get("date") || String(body.serviceDate || "");
    if (date) {
      next.dispatchByDate[date] = {
        jobs: Array.isArray(body.jobs) ? (body.jobs as Job[]) : [],
        serviceDate: String(body.serviceDate || date),
      };
    }
    return next;
  }
  if (path === "/api/field/dispatch/goods") {
    next.goods = Array.isArray(body.items) ? (body.items as GoodsItem[]) : [];
    return next;
  }
  if (path === "/api/field/dispatch/calendar") {
    next.calendars[search || ""] = body;
    return next;
  }
  if (path === "/api/field/maintenance/events") {
    const events = Array.isArray(body.events) ? (body.events as EventRow[]) : [];
    next.events = events;
    for (const event of events) {
      if (event?.id && !next.eventDetails[event.id]) next.eventDetails[event.id] = event;
    }
    return next;
  }
  if (path === "/api/field/maintenance/catalog") {
    next.catalogGroups = Array.isArray(body.groups) ? (body.groups as CatalogGroup[]) : [];
    return next;
  }
  const eventGet = /^\/api\/field\/maintenance\/events\/([^/]+)$/i.exec(path);
  if (eventGet && body.event) {
    const event = body.event as EventRow;
    next.eventDetails[eventGet[1]] = event;
    if (next.events) {
      next.events = next.events.map((row) => (row.id === event.id ? { ...row, ...event } : row));
    }
    return next;
  }
  const photos = /^\/api\/field\/dispatch\/jobs\/[^/]+\/stops\/([^/]+)\/photos$/i.exec(path);
  if (photos) {
    next.stopPhotos[photos[1]] = Array.isArray(body.photos) ? (body.photos as Photo[]) : [];
  }
  return next;
}

export function readOfflineGet(snap: OfflineSnap, pathAndQuery: string): OfflineHttpResult | null {
  const { path, search } = offlineApiPath(pathAndQuery);
  if (path === "/api/field/dispatch/jobs") {
    const date = new URLSearchParams(search).get("date") || "";
    const list = snap.dispatchByDate[date];
    if (!list) return null;
    return { status: 200, json: { jobs: list.jobs, serviceDate: list.serviceDate || date } };
  }
  if (path === "/api/field/dispatch/goods") {
    if (!snap.goods) return null;
    return { status: 200, json: { items: snap.goods } };
  }
  if (path === "/api/field/dispatch/calendar") {
    const cached = snap.calendars[search || ""];
    if (!cached) return null;
    return { status: 200, json: cached };
  }
  if (path === "/api/field/maintenance/events") {
    if (!snap.events) return null;
    return { status: 200, json: { events: snap.events } };
  }
  if (path === "/api/field/maintenance/catalog") {
    if (!snap.catalogGroups) return null;
    return { status: 200, json: { groups: snap.catalogGroups } };
  }
  const eventGet = /^\/api\/field\/maintenance\/events\/([^/]+)$/i.exec(path);
  if (eventGet) {
    const event = snap.eventDetails[eventGet[1]];
    if (!event) return null;
    return { status: 200, json: { event } };
  }
  const photos = /^\/api\/field\/dispatch\/jobs\/[^/]+\/stops\/([^/]+)\/photos$/i.exec(path);
  if (photos) {
    return { status: 200, json: { photos: snap.stopPhotos[photos[1]] || [] } };
  }
  return null;
}

function localPhoto(body: Record<string, unknown>, at: string): Photo {
  const dataUrl = String(body.dataUrl || body.data || "");
  return {
    id: `local-${Math.random().toString(36).slice(2, 10)}`,
    url: dataUrl,
    caption: String(body.caption || ""),
    createdAt: at,
  };
}

function closeJobIfStopsDone(job: Job, at: string): Job {
  const stops = job.stops || [];
  if (!stops.length) return job;
  const open = stops.some((stop) => stop.status !== "done" && stop.status !== "skipped");
  if (open || job.status === "done" || job.status === "cancelled") return job;
  return { ...job, status: "done", completedAt: job.completedAt || at };
}

export function applyOfflineWrite(
  snap: OfflineSnap,
  method: string,
  pathAndQuery: string,
  body: unknown,
  at: string,
): { snap: OfflineSnap; result: OfflineHttpResult } | { error: string } {
  const { path } = offlineApiPath(pathAndQuery);
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const m = method.toUpperCase();

  const jobPatch = m === "PATCH" ? /^\/api\/field\/dispatch\/jobs\/([^/]+)$/i.exec(path) : null;
  if (jobPatch) {
    const current = findJob(snap, jobPatch[1]);
    if (!current) return { error: "This job is not saved on this phone yet" };
    if (current.status === "done" || current.status === "cancelled") {
      return { error: "Completed jobs cannot be edited" };
    }
    const job = { ...current, stops: current.stops ? current.stops.map((s) => ({ ...s })) : [] };
    if ("status" in payload) {
      const status = String(payload.status || "").toLowerCase();
      if (!["en_route", "arrived", "done"].includes(status)) {
        return { error: "Field may set status to en_route, arrived, or done" };
      }
      job.status = status;
      if (status === "en_route") job.startedAt = job.startedAt || at;
      if (status === "arrived") job.arrivedAt = job.arrivedAt || at;
      if (status === "done") job.completedAt = job.completedAt || at;
    }
    if ("fieldNote" in payload) job.fieldNote = String(payload.fieldNote || "");
    const next = replaceJob(snap, job);
    next.syncedAt = snap.syncedAt;
    return { snap: next, result: { status: 200, json: { job } } };
  }

  const stopPatch =
    m === "PATCH" ? /^\/api\/field\/dispatch\/jobs\/([^/]+)\/stops\/([^/]+)$/i.exec(path) : null;
  if (stopPatch) {
    const current = findJob(snap, stopPatch[1]);
    if (!current) return { error: "This job is not saved on this phone yet" };
    const stops = (current.stops || []).map((stop) => ({ ...stop }));
    const idx = stops.findIndex((stop) => stop.id === stopPatch[2]);
    if (idx < 0) return { error: "Stop not found" };
    const stop = stops[idx]!;
    if (!("status" in payload) && "notes" in payload) {
      stop.notes = String(payload.notes || "");
    } else {
      const status = String(payload.status || "").toLowerCase();
      if (!["arrived", "done", "skipped"].includes(status)) {
        return { error: "Stop status must be arrived, done, or skipped" };
      }
      if (stop.status === "done") return { error: "Completed stops cannot be changed" };
      stop.status = status;
      if ("notes" in payload) stop.notes = String(payload.notes || "");
      if (status === "arrived") stop.startedAt = stop.startedAt || at;
      if (status === "done" || status === "skipped") stop.completedAt = stop.completedAt || at;
      const lat = Number(payload.phoneLat);
      const lon = Number(payload.phoneLon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (status === "arrived") {
          stop.startPhoneLat = stop.startPhoneLat ?? lat;
          stop.startPhoneLon = stop.startPhoneLon ?? lon;
        }
        if (status === "done" || status === "skipped") {
          stop.completePhoneLat = lat;
          stop.completePhoneLon = lon;
        }
      }
    }
    stops[idx] = stop;
    let job: Job = { ...current, stops };
    job = closeJobIfStopsDone(job, at);
    const next = replaceJob(snap, job);
    return { snap: next, result: { status: 200, json: { stop, job } } };
  }

  const linesPut = m === "PUT" ? /^\/api\/field\/dispatch\/orders\/([^/]+)\/lines$/i.exec(path) : null;
  if (linesPut) {
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    let updated: Job | null = null;
    const next = clone(snap);
    for (const list of Object.values(next.dispatchByDate)) {
      list.jobs = list.jobs.map((job) => {
        const stops = (job.stops || []).map((stop) =>
          stop.orderId === linesPut[1] ? { ...stop, lines } : stop,
        );
        const changed = stops.some((stop, i) => stop !== (job.stops || [])[i]);
        if (!changed) return job;
        updated = { ...job, stops };
        return updated;
      });
    }
    if (!updated) return { error: "Order not found on a saved job" };
    return { snap: next, result: { status: 200, json: { lines, job: updated } } };
  }

  const dispatchPhoto =
    m === "POST" ? /^\/api\/field\/dispatch\/jobs\/[^/]+\/stops\/([^/]+)\/photos$/i.exec(path) : null;
  if (dispatchPhoto) {
    const photo = localPhoto(payload, at);
    const next = clone(snap);
    next.stopPhotos[dispatchPhoto[1]] = [...(next.stopPhotos[dispatchPhoto[1]] || []), photo];
    return { snap: next, result: { status: 201, json: { photo } } };
  }

  const eventPatch = m === "PATCH" ? /^\/api\/field\/maintenance\/events\/([^/]+)$/i.exec(path) : null;
  if (eventPatch) {
    const current = snap.eventDetails[eventPatch[1]] || snap.events?.find((row) => row.id === eventPatch[1]);
    if (!current) return { error: "This job is not saved on this phone yet" };
    const event: EventRow = { ...current };
    if ("status" in payload) {
      event.status = String(payload.status || event.status || "");
      if (event.status === "in_progress") event.startedAt = event.startedAt || at;
      if (event.status === "done" || event.status === "skipped") event.endedAt = event.endedAt || at;
    }
    if ("notes" in payload) event.notes = String(payload.notes || "");
    if ("odometerKm" in payload) {
      event.odometerKm = payload.odometerKm == null || payload.odometerKm === "" ? null : Number(payload.odometerKm);
    }
    if (Array.isArray(payload.lines)) event.lines = payload.lines;
    const next = clone(snap);
    next.eventDetails[event.id] = event;
    if (next.events) next.events = next.events.map((row) => (row.id === event.id ? { ...row, ...event } : row));
    return { snap: next, result: { status: 200, json: { event, nextEvent: null } } };
  }

  const maintPhoto =
    m === "POST" ? /^\/api\/field\/maintenance\/events\/([^/]+)\/photos$/i.exec(path) : null;
  if (maintPhoto) {
    const current = snap.eventDetails[maintPhoto[1]] || snap.events?.find((row) => row.id === maintPhoto[1]);
    if (!current) return { error: "This job is not saved on this phone yet" };
    const photo = localPhoto(payload, at);
    const event: EventRow = { ...current, photos: [...(current.photos || []), photo] };
    const next = clone(snap);
    next.eventDetails[event.id] = event;
    if (next.events) next.events = next.events.map((row) => (row.id === event.id ? { ...row, ...event } : row));
    return { snap: next, result: { status: 201, json: { photo } } };
  }

  return { error: "This action cannot be saved offline" };
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function parseCode(raw: string): { kind: string | null; code: string } {
  const trimmed = String(raw || "").trim();
  const match = trimmed.match(/^am1:v\d+:(goods|part|vehicle|location):(.+)$/i);
  if (!match) return { kind: null, code: norm(trimmed) };
  const token = match[1].toLowerCase();
  return { kind: token === "part" ? "maint_part" : token, code: norm(match[2]) };
}

export function offlineCatalogScan(snap: OfflineSnap, rawCode: string, context: string): OfflineHttpResult {
  const parsed = parseCode(rawCode);
  const code = parsed.code;
  if (!code) return { status: 200, json: { match: "none", reason: "empty", code: "", raw: rawCode } };

  const wantGoods = (!parsed.kind || parsed.kind === "goods") && parsed.kind !== "vehicle" && parsed.kind !== "location";
  const wantPart = (!parsed.kind || parsed.kind === "maint_part") && parsed.kind !== "vehicle" && parsed.kind !== "location";
  if ((context === "dispatch_cargo" || context === "any") && wantGoods && snap.goods) {
    const bySku = snap.goods.find((row) => row.sku && norm(row.sku) === code && row.enabled !== false);
    const named = snap.goods.filter((row) => norm(row.name) === code && row.enabled !== false);
    const hit = bySku || (named.length === 1 ? named[0] : undefined);
    if (hit) return { status: 200, json: { match: "goods", code, raw: rawCode, codeFormat: "sku", item: hit } };
  }
  if ((context === "maint_part" || context === "any") && wantPart && snap.catalogGroups && parsed.kind !== "vehicle") {
    const parts = snap.catalogGroups
      .filter((group) => group.key === "part")
      .flatMap((group) => group.items || []);
    const bySku = parts.find((row) => row.sku && norm(row.sku) === code && row.enabled !== false);
    const named = parts.filter((row) => norm(row.name) === code && row.enabled !== false);
    const hit = bySku || (named.length === 1 ? named[0] : undefined);
    if (hit) return { status: 200, json: { match: "maint_part", code, raw: rawCode, codeFormat: "sku", item: hit } };
  }
  if ((context === "vehicle" || context === "any") && (parsed.kind === "vehicle" || (!parsed.kind && context === "vehicle"))) {
    const uid = Number(code);
    if (Number.isFinite(uid) && uid > 0) {
      return {
        status: 200,
        json: {
          match: "vehicle",
          code,
          raw: rawCode,
          codeFormat: "sku",
          item: { id: String(uid), armadaUserId: uid },
        },
      };
    }
  }
  return { status: 200, json: { match: "none", reason: "unknown", code, raw: rawCode } };
}

export function absorbServerBody(snap: OfflineSnap, json: unknown): OfflineSnap {
  if (!json || typeof json !== "object") return snap;
  const body = json as { job?: Job; event?: EventRow };
  let next = snap;
  if (body.job?.id) next = replaceJob(next, body.job);
  if (body.event?.id) {
    next = clone(next);
    next.eventDetails[body.event.id] = body.event;
    if (next.events) {
      next.events = next.events.map((row) => (row.id === body.event!.id ? { ...row, ...body.event } : row));
    }
  }
  return next;
}
