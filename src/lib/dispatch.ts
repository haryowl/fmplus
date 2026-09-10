import { currentTenantKey, tenantHeaders } from "./tenant";

export type DispatchStatus =
  | "draft"
  | "assigned"
  | "en_route"
  | "arrived"
  | "done"
  | "cancelled";

export type DispatchStopStatus = "pending" | "arrived" | "done" | "skipped";

export type DispatchOrderStatus = "pending" | "assigned" | "cancelled";

export type DispatchStop = {
  id: string;
  orderId?: string | null;
  sortOrder: number;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  notes: string;
  zone?: string;
  volumeM3?: number | null;
  weightKg?: number | null;
  windowStart?: string;
  windowEnd?: string;
  status: DispatchStopStatus;
  arrivedAt: string | null;
  completedAt: string | null;
};

export type DispatchJob = {
  id: string;
  status: DispatchStatus;
  title: string;
  notes: string;
  armadaUserId: number | null;
  armadaUsername: string;
  userDisplayName: string;
  assignedFieldUserId: string | null;
  assigneeUsername?: string;
  assigneeDisplayName?: string;
  assignedAt: string | null;
  startedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  fieldNote: string;
  /** Plan / service day YYYY-MM-DD */
  serviceDate: string;
  createdAt: string;
  updatedAt: string;
  volumeCapacityM3?: number;
  weightCapacityKg?: number;
  volumeUsed?: number;
  weightUsed?: number;
  utilizationPct?: number;
  stops: DispatchStop[];
};

export type DispatchOrder = {
  id: string;
  externalRef: string;
  customerName: string;
  address: string;
  lat: number | null;
  lon: number | null;
  zone: string;
  volumeM3: number | null;
  weightKg: number | null;
  windowStart: string;
  windowEnd: string;
  /** Promised / plan day YYYY-MM-DD */
  serviceDate: string;
  status: DispatchOrderStatus;
  jobId: string | null;
  stopId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type DispatchFieldUser = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  enabled: boolean;
};

export type DispatchPhoto = {
  id: string;
  stopId?: string | null;
  contentType: string;
  bytes: number | null;
  caption: string;
  createdAt: string;
  url: string;
};

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  draft: "Draft",
  assigned: "Assigned",
  en_route: "En route",
  arrived: "Arrived",
  done: "Done",
  cancelled: "Cancelled",
};

export function dispatchVehicleLabel(job: DispatchJob): string {
  return job.userDisplayName || job.armadaUsername || (job.armadaUserId ? `#${job.armadaUserId}` : "—");
}

export function dispatchAssigneeLabel(job: DispatchJob): string {
  return job.assigneeDisplayName || job.assigneeUsername || "Unassigned";
}

export function formatDispatchWindow(stop: { windowStart?: string; windowEnd?: string }): string {
  const a = (stop.windowStart || "").trim();
  const b = (stop.windowEnd || "").trim();
  if (a && b) return `${a}–${b}`;
  return a || b || "";
}

export function utilizationTone(pct: number | undefined): "ok" | "warn" | "over" {
  const n = pct ?? 0;
  if (n > 100) return "over";
  if (n >= 92) return "warn";
  return "ok";
}

/** Local calendar day as YYYY-MM-DD. */
export function todayServiceDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function shiftServiceDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function formatServiceDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export async function fetchDispatchJobs(
  status: "open" | "all" | DispatchStatus = "open",
  signal?: AbortSignal,
  serviceDate?: string,
): Promise<DispatchJob[]> {
  const date = serviceDate || todayServiceDate();
  const res = await fetch(
    `/api/dispatch/jobs?status=${encodeURIComponent(status)}&date=${encodeURIComponent(date)}&limit=100`,
    {
      headers: { accept: "application/json", ...tenantHeaders() },
      signal,
    },
  );
  const data = (await res.json().catch(() => ({}))) as { jobs?: DispatchJob[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Dispatch ${res.status}`);
  return data.jobs || [];
}

export async function fetchDispatchJob(id: string): Promise<DispatchJob> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(id)}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Job ${res.status}`);
  if (!data.job) throw new Error("Job missing");
  return data.job;
}

export async function createDispatchJob(body: {
  title: string;
  notes?: string;
  serviceDate?: string;
  armadaUserId?: number | null;
  armadaUsername?: string;
  userDisplayName?: string;
  assignedFieldUserId?: string | null;
  volumeCapacityM3?: number | null;
  weightCapacityKg?: number | null;
  stops?: Array<{
    name?: string;
    address?: string;
    lat?: number | null;
    lon?: number | null;
    notes?: string;
    zone?: string;
    volumeM3?: number | null;
    weightKg?: number | null;
    windowStart?: string;
    windowEnd?: string;
  }>;
}): Promise<DispatchJob> {
  const res = await fetch("/api/dispatch/jobs", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Create ${res.status}`);
  if (!data.job) throw new Error("Create failed");
  return data.job;
}

export async function patchDispatchJob(
  id: string,
  patch: Record<string, unknown>,
): Promise<DispatchJob> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Patch ${res.status}`);
  if (!data.job) throw new Error("Patch failed");
  return data.job;
}

export async function assignOrdersToJob(jobId: string, orderIds: string[]): Promise<DispatchJob> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(jobId)}/assign-orders`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({ orderIds }),
  });
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Assign ${res.status}`);
  if (!data.job) throw new Error("Assign failed");
  return data.job;
}

/** Remove a stop from a job; linked order returns to the pending inbox. */
export async function returnStopToInbox(jobId: string, stopId: string): Promise<DispatchJob> {
  const res = await fetch(
    `/api/dispatch/jobs/${encodeURIComponent(jobId)}/stops/${encodeURIComponent(stopId)}/return`,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
      body: "{}",
    },
  );
  const data = (await res.json().catch(() => ({}))) as { job?: DispatchJob; error?: string };
  if (!res.ok) throw new Error(data.error || `Return stop ${res.status}`);
  if (!data.job) throw new Error("Return stop failed");
  return data.job;
}

export async function optimizeJobStops(jobId: string): Promise<{
  job: DispatchJob;
  route: import("./routePlan").RouteGeometryResult | null;
}> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(jobId)}/optimize-stops`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as {
    job?: DispatchJob;
    route?: import("./routePlan").RouteGeometryResult;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Optimize ${res.status}`);
  if (!data.job) throw new Error("Optimize failed");
  return { job: data.job, route: data.route || null };
}

export async function fetchDispatchFieldUsers(): Promise<DispatchFieldUser[]> {
  const res = await fetch("/api/dispatch/field-users", {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { users?: DispatchFieldUser[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Field users ${res.status}`);
  return data.users || [];
}

export async function fetchDispatchOrders(
  status: "pending" | "all" | DispatchOrderStatus = "pending",
  signal?: AbortSignal,
  serviceDate?: string,
): Promise<DispatchOrder[]> {
  const date = serviceDate || todayServiceDate();
  const res = await fetch(
    `/api/dispatch/orders?status=${encodeURIComponent(status)}&date=${encodeURIComponent(date)}&limit=100`,
    {
      headers: { accept: "application/json", ...tenantHeaders() },
      signal,
    },
  );
  const data = (await res.json().catch(() => ({}))) as { orders?: DispatchOrder[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Orders ${res.status}`);
  return data.orders || [];
}

export async function createDispatchOrder(body: {
  customerName: string;
  externalRef?: string;
  address?: string;
  lat?: number | null;
  lon?: number | null;
  zone?: string;
  volumeM3?: number | null;
  weightKg?: number | null;
  windowStart?: string;
  windowEnd?: string;
  serviceDate?: string;
  notes?: string;
}): Promise<DispatchOrder> {
  const res = await fetch("/api/dispatch/orders", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { order?: DispatchOrder; error?: string };
  if (!res.ok) throw new Error(data.error || `Create order ${res.status}`);
  if (!data.order) throw new Error("Create order failed");
  return data.order;
}

export async function patchDispatchOrder(
  id: string,
  patch: Record<string, unknown>,
): Promise<DispatchOrder> {
  const res = await fetch(`/api/dispatch/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as { order?: DispatchOrder; error?: string };
  if (!res.ok) throw new Error(data.error || `Patch order ${res.status}`);
  if (!data.order) throw new Error("Patch order failed");
  return data.order;
}

export async function cancelDispatchOrder(id: string): Promise<DispatchOrder> {
  return patchDispatchOrder(id, { status: "cancelled" });
}

export async function deleteDispatchOrder(id: string): Promise<void> {
  const res = await fetch(`/api/dispatch/orders/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Delete order ${res.status}`);
}

export async function fetchStopPhotos(stopId: string, field = false): Promise<DispatchPhoto[]> {
  const path = field
    ? null
    : `/api/dispatch/stops/${encodeURIComponent(stopId)}/photos`;
  if (!path) throw new Error("Use fieldStopPhotos for field");
  const res = await fetch(path, {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { photos?: DispatchPhoto[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Photos ${res.status}`);
  return data.photos || [];
}

export async function fieldStopPhotos(jobId: string, stopId: string): Promise<DispatchPhoto[]> {
  const res = await fetch(
    `/api/field/dispatch/jobs/${encodeURIComponent(jobId)}/stops/${encodeURIComponent(stopId)}/photos`,
    { credentials: "include", headers: { accept: "application/json" } },
  );
  const data = (await res.json().catch(() => ({}))) as { photos?: DispatchPhoto[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Photos ${res.status}`);
  return data.photos || [];
}

export async function uploadDispatchStopPhoto(
  jobId: string,
  stopId: string,
  dataUrl: string,
  caption = "",
): Promise<DispatchPhoto> {
  const res = await fetch(
    `/api/field/dispatch/jobs/${encodeURIComponent(jobId)}/stops/${encodeURIComponent(stopId)}/photos`,
    {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ dataUrl, caption }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as { photo?: DispatchPhoto; error?: string };
  if (!res.ok) throw new Error(data.error || `Upload ${res.status}`);
  if (!data.photo) throw new Error("Upload failed");
  return data.photo;
}

/** Parse lines like: -6.2, 106.8 Depot A */
export function parseStopPaste(text: string): Array<{
  name: string;
  lat: number | null;
  lon: number | null;
}> {
  const out: Array<{ name: string; lat: number | null; lon: number | null }> = [];
  for (const line of text.split(/[\n;]+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[,|\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) {
      out.push({ name: trimmed.slice(0, 200), lat: null, lon: null });
      continue;
    }
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      out.push({
        lat,
        lon,
        name: parts.slice(2).join(" ").slice(0, 200) || `Stop ${out.length + 1}`,
      });
    } else {
      out.push({ name: trimmed.slice(0, 200), lat: null, lon: null });
    }
  }
  return out;
}

export function mapsNavigateUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}

/** Append tenant key so <img src> works without X-Fms-Tenant header. */
export function withTenantQuery(url: string): string {
  const k = currentTenantKey();
  if (!k || !url) return url;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}k=${encodeURIComponent(k)}`;
}
