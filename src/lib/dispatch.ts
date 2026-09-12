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

export type DispatchRouteAnchor = {
  lat: number;
  lon: number;
  label: string;
};

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
  /** Minutes at stop; null/undefined = use plan default */
  serviceMinutes?: number | null;
  proofRequired?: boolean;
  status: DispatchStopStatus;
  arrivedAt: string | null;
  completedAt: string | null;
  startPhoneLat?: number | null;
  startPhoneLon?: number | null;
  startArmadaLat?: number | null;
  startArmadaLon?: number | null;
  completePhoneLat?: number | null;
  completePhoneLon?: number | null;
  completeArmadaLat?: number | null;
  completeArmadaLon?: number | null;
  skipReason?: string;
  rescheduledTo?: string | null;
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
  routeAnchorMode?: "map" | "sequence" | null;
  routeStart?: DispatchRouteAnchor | null;
  routeEnd?: DispatchRouteAnchor | null;
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
  /** Minutes at stop; null = use Auto-plan Service min / stop */
  serviceMinutes: number | null;
  /** When true, field FINISH requires at least one POD photo */
  proofRequired: boolean;
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

/** Per-vehicle capacity preset (Armada GPS user within tenant). */
export type VehicleCapacity = {
  armadaUserId: number;
  volumeCapacityM3: number;
  weightCapacityKg: number;
  label?: string;
  depotId?: string | null;
  plateParity?: "odd" | "even" | "unknown" | "exempt";
  updatedAt?: string;
};

export type DispatchDepot = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  isDefault: boolean;
  updatedAt?: string | null;
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

/** e.g. "12 min stop" or empty when unset (plan default). */
export function formatDispatchServiceMinutes(
  stop: { serviceMinutes?: number | null },
  fallbackDefault?: number | null,
): string {
  const raw = stop.serviceMinutes;
  if (raw != null && Number.isFinite(Number(raw))) {
    return `${Math.round(Number(raw))} min stop`;
  }
  if (fallbackDefault != null && Number.isFinite(Number(fallbackDefault))) {
    return `${Math.round(Number(fallbackDefault))} min stop`;
  }
  return "";
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

export async function assignOrdersToJob(
  jobId: string,
  orderIds: string[],
  opts?: { rejectOverCapacity?: boolean },
): Promise<DispatchJob> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(jobId)}/assign-orders`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({
      orderIds,
      rejectOverCapacity: opts?.rejectOverCapacity === true,
    }),
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

export async function optimizeJobStops(
  jobId: string,
  routing?: import("./routePlan").RoutingOptions | null,
): Promise<{
  job: DispatchJob;
  route: import("./routePlan").RouteGeometryResult | null;
}> {
  const res = await fetch(`/api/dispatch/jobs/${encodeURIComponent(jobId)}/optimize-stops`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({
      routing: {
        avoidTolls: Boolean(routing?.avoidTolls),
        avoidMotorways: Boolean(routing?.avoidMotorways),
        avoidFerries: Boolean(routing?.avoidFerries),
        respectGanjilGenap: Boolean(routing?.respectGanjilGenap),
        plateParity: routing?.plateParity || "unknown",
      },
    }),
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

export type DispatchFleetMode = "jobs" | "presets" | "both";
export type DispatchDepotMode = "open" | "depot" | "multi";
/** How depot/start appears on the road after plan. */
export type DispatchDepotPathMode = "calc" | "map" | "sequence";
/** Open-tour start point. */
export type DispatchOpenStartMode = "none" | "vehicle";
export type DispatchTwMode = "off" | "soft" | "hard";

export type DispatchPlanDayStop = {
  orderId: string | null;
  label: string;
  arriveAt: string;
  departAt?: string;
  serviceMinutes?: number;
  windowStart: string;
  windowEnd: string;
  late: boolean;
  early: boolean;
};

export type DispatchPlanDayRoute = {
  key: string;
  label: string;
  jobId?: string;
  orderIds: string[];
  volumeUsed: number;
  weightUsed: number;
  volumeCapacityM3: number;
  weightCapacityKg: number;
  utilizationPct: number;
  distanceKm: number;
  lateStops?: number;
  stops?: DispatchPlanDayStop[];
  meta?: Record<string, unknown>;
  depotId?: string;
  depotName?: string;
  pathMode?: DispatchDepotPathMode;
  routeStart?: DispatchRouteAnchor | null;
  routeEnd?: DispatchRouteAnchor | null;
};

export type DispatchPlanDayResult = {
  serviceDate: string;
  fleetMode: DispatchFleetMode;
  depotMode: DispatchDepotMode;
  depotPathMode?: DispatchDepotPathMode;
  openStartMode?: DispatchOpenStartMode;
  apply: boolean;
  engine: string;
  warning: string | null;
  depot: { lat: number; lon: number } | null;
  depots?: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    orderCount: number;
    vehicleCount: number;
  }[] | null;
  roundtrip: boolean;
  balanceMoves?: number;
  twMode?: DispatchTwMode;
  serviceMinutes?: number;
  dayStartMin?: number;
  maxStopsPerVehicle?: number;
  onlyEmptyJobs?: boolean;
  routing?: {
    avoidTolls?: boolean;
    avoidMotorways?: boolean;
    avoidFerries?: boolean;
    exclude?: string[];
  } | null;
  routes: DispatchPlanDayRoute[];
  unassigned: { orderId: string; label?: string; reason: string; depotId?: string }[];
  vehicleCount: number;
  orderCount: number;
};

export async function fetchDispatchDepot(): Promise<{
  lat: number;
  lon: number;
  id?: string;
  name?: string;
} | null> {
  const res = await fetch("/api/dispatch/depot", {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as {
    depot?: { lat: number; lon: number; id?: string; name?: string } | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Depot ${res.status}`);
  return data.depot || null;
}

export async function saveDispatchDepot(
  depot: { lat: number; lon: number } | null,
): Promise<{ lat: number; lon: number; id?: string; name?: string } | null> {
  const res = await fetch("/api/dispatch/depot", {
    method: "PUT",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(depot == null ? { depot: null } : depot),
  });
  const data = (await res.json().catch(() => ({}))) as {
    depot?: { lat: number; lon: number; id?: string; name?: string } | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Save depot ${res.status}`);
  return data.depot || null;
}

export async function fetchDispatchDepots(): Promise<DispatchDepot[]> {
  const res = await fetch("/api/dispatch/depots", {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as {
    depots?: DispatchDepot[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Depots ${res.status}`);
  return data.depots || [];
}

export async function createDispatchDepot(body: {
  name?: string;
  lat: number;
  lon: number;
  isDefault?: boolean;
}): Promise<DispatchDepot> {
  const res = await fetch("/api/dispatch/depots", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    depot?: DispatchDepot;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Create depot ${res.status}`);
  if (!data.depot) throw new Error("Create depot failed");
  return data.depot;
}

export async function patchDispatchDepot(
  id: string,
  body: { name?: string; lat?: number; lon?: number; isDefault?: boolean },
): Promise<DispatchDepot> {
  const res = await fetch(`/api/dispatch/depots/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    depot?: DispatchDepot;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Update depot ${res.status}`);
  if (!data.depot) throw new Error("Update depot failed");
  return data.depot;
}

export async function deleteDispatchDepot(id: string): Promise<void> {
  const res = await fetch(`/api/dispatch/depots/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Delete depot ${res.status}`);
}

export async function planDispatchDay(body: {
  serviceDate: string;
  fleetMode: DispatchFleetMode;
  depotMode: DispatchDepotMode;
  depotPathMode?: DispatchDepotPathMode;
  openStartMode?: DispatchOpenStartMode;
  apply?: boolean;
  roundtrip?: boolean;
  depotLat?: number | null;
  depotLon?: number | null;
  persistDepot?: boolean;
  depotIds?: string[];
  twMode?: DispatchTwMode;
  serviceMinutes?: number;
  dayStart?: string;
  maxStopsPerVehicle?: number;
  onlyEmptyJobs?: boolean;
  routing?: {
    avoidTolls?: boolean;
    avoidMotorways?: boolean;
    avoidFerries?: boolean;
    respectGanjilGenap?: boolean;
    plateParity?: "odd" | "even" | "unknown" | "exempt";
  };
}): Promise<DispatchPlanDayResult> {
  const res = await fetch("/api/dispatch/plan-day", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    plan?: DispatchPlanDayResult;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Plan day ${res.status}`);
  if (!data.plan) throw new Error("Plan day failed");
  return data.plan;
}

export async function fetchDispatchFieldUsers(): Promise<DispatchFieldUser[]> {
  const res = await fetch("/api/dispatch/field-users", {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { users?: DispatchFieldUser[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Field users ${res.status}`);
  return data.users || [];
}

export async function fetchVehicleCapacities(signal?: AbortSignal): Promise<VehicleCapacity[]> {
  const res = await fetch("/api/dispatch/vehicle-capacities", {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    capacities?: VehicleCapacity[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Vehicle capacities ${res.status}`);
  return data.capacities || [];
}

export async function upsertVehicleCapacity(body: {
  armadaUserId: number;
  volumeCapacityM3: number;
  weightCapacityKg: number;
  label?: string;
  depotId?: string | null;
  plateParity?: "odd" | "even" | "unknown" | "exempt" | null;
}): Promise<VehicleCapacity> {
  const res = await fetch(`/api/dispatch/vehicle-capacities/${encodeURIComponent(String(body.armadaUserId))}`, {
    method: "PUT",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({
      volumeCapacityM3: body.volumeCapacityM3,
      weightCapacityKg: body.weightCapacityKg,
      label: body.label,
      ...(Object.prototype.hasOwnProperty.call(body, "depotId") ? { depotId: body.depotId } : {}),
      ...(Object.prototype.hasOwnProperty.call(body, "plateParity") ? { plateParity: body.plateParity } : {}),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    capacity?: VehicleCapacity;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Save capacity ${res.status}`);
  if (!data.capacity) throw new Error("Save capacity failed");
  return data.capacity;
}

export function capacityForVehicle(
  capacities: VehicleCapacity[],
  armadaUserId: number | null | undefined,
): { volumeCapacityM3: number; weightCapacityKg: number } {
  const id = armadaUserId == null ? null : Number(armadaUserId);
  const hit = id != null ? capacities.find((c) => c.armadaUserId === id) : undefined;
  return {
    volumeCapacityM3: hit?.volumeCapacityM3 ?? 12,
    weightCapacityKg: hit?.weightCapacityKg ?? 1500,
  };
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
  serviceMinutes?: number | null;
  proofRequired?: boolean;
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

export type DispatchCalendarSummary = {
  pending: number;
  inProgress: number;
  completed: number;
};

export async function fieldDispatchCalendar(
  from: string,
  to: string,
): Promise<{ days: { date: string; jobCount: number }[]; summary: DispatchCalendarSummary }> {
  const res = await fetch(
    `/api/field/dispatch/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: "include", headers: { accept: "application/json" } },
  );
  const data = (await res.json().catch(() => ({}))) as {
    days?: { date: string; jobCount: number }[];
    summary?: DispatchCalendarSummary;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Calendar ${res.status}`);
  return {
    days: data.days || [],
    summary: {
      pending: Number(data.summary?.pending) || 0,
      inProgress: Number(data.summary?.inProgress) || 0,
      completed: Number(data.summary?.completed) || 0,
    },
  };
}

export type FieldStopPatchBody = {
  status?: "arrived" | "done" | "skipped";
  notes?: string;
  phoneLat?: number | null;
  phoneLon?: number | null;
  skipReason?: string;
  rescheduleDate?: string;
};

export async function fieldPatchStop(
  jobId: string,
  stopId: string,
  body: FieldStopPatchBody,
): Promise<{ job: DispatchJob; stop: DispatchStop }> {
  const res = await fetch(
    `/api/field/dispatch/jobs/${encodeURIComponent(jobId)}/stops/${encodeURIComponent(stopId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    job?: DispatchJob;
    stop?: DispatchStop;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Stop update ${res.status}`);
  if (!data.job || !data.stop) throw new Error("Stop update failed");
  return { job: data.job, stop: data.stop };
}

/** Browser geolocation; null if denied/unavailable. */
export function readPhonePosition(timeoutMs = 12_000): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          resolve(null);
          return;
        }
        resolve({ lat, lon });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
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
