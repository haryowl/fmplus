import { ageLabel } from "./lastStatus";
import { tenantHeaders } from "./tenant";
import { downloadXlsx, excelFilename, type ExcelCell } from "./xlsxDownload";

export type ServiceEventStatus = "due" | "in_progress" | "done" | "skipped";
export type LineKind = "part" | "labor" | "other";

export type ServiceLine = {
  id?: string;
  kind: LineKind;
  description: string;
  qty: number;
  unitPrice: number | null;
  unitCost: number | null;
  vendor: string;
  sortOrder?: number;
  linePrice?: number | null;
  lineCost?: number | null;
};

export type ServicePhoto = {
  id: string;
  contentType: string;
  bytes: number | null;
  caption: string;
  createdAt: string;
  url: string;
};

export type ServiceEvent = {
  id: string;
  status: ServiceEventStatus;
  title: string;
  notes: string;
  armadaUserId: number | null;
  armadaUsername: string;
  userDisplayName: string;
  lat: number | null;
  lon: number | null;
  notificationId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  odometerKm: number | null;
  servicePointId?: string | null;
  servicePointName?: string;
  servicePointLat?: number | null;
  servicePointLon?: number | null;
  assignedFieldUserId?: string | null;
  remindDueAt?: string | null;
  remindIntervalDays?: number | null;
  remindIntervalKm?: number | null;
  remindBaselineOdometerKm?: number | null;
  remindIntervalHours?: number | null;
  remindHoursSinceAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: ServiceLine[];
  photos?: ServicePhoto[];
  priceTotal?: number | null;
  costTotal?: number | null;
};

export type ServicePoint = {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  notes: string;
  pointType: string;
};

export type FieldUserOption = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  enabled: boolean;
};

export type MaintenanceStatusFilter = ServiceEventStatus | "open" | "all";

export const SERVICE_STATUS_LABELS: Record<ServiceEventStatus, string> = {
  due: "Due",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
};

export const LINE_KIND_LABELS: Record<LineKind, string> = {
  part: "Part",
  labor: "Labor",
  other: "Other",
};

export async function fetchServiceEvents(
  status: MaintenanceStatusFilter = "open",
  signal?: AbortSignal,
): Promise<ServiceEvent[]> {
  const res = await fetch(`/api/maintenance/events?status=${encodeURIComponent(status)}&limit=100`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { events?: ServiceEvent[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Maintenance ${res.status}`);
  return data.events || [];
}

export async function fetchServiceEvent(id: string, signal?: AbortSignal): Promise<ServiceEvent> {
  const res = await fetch(`/api/maintenance/events/${id}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { event?: ServiceEvent; error?: string };
  if (!res.ok) throw new Error(data.error || `Maintenance ${res.status}`);
  if (!data.event) throw new Error("Not found");
  return data.event;
}

export async function createServiceEvent(body: {
  title: string;
  notes?: string;
  armadaUsername?: string;
  userDisplayName?: string;
  armadaUserId?: number | null;
  lat?: number | null;
  lon?: number | null;
  odometerKm?: number | null;
  remindDueAt?: string | null;
  remindIntervalDays?: number | null;
  remindIntervalKm?: number | null;
  remindBaselineOdometerKm?: number | null;
  remindIntervalHours?: number | null;
  remindHoursSinceAt?: string | null;
}): Promise<ServiceEvent> {
  const res = await fetch("/api/maintenance/events", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { event?: ServiceEvent; error?: string };
  if (!res.ok) throw new Error(data.error || `Create ${res.status}`);
  if (!data.event) throw new Error("Create failed");
  return data.event;
}

export async function patchServiceEvent(
  id: string,
  body: Record<string, unknown>,
): Promise<ServiceEvent> {
  const res = await fetch(`/api/maintenance/events/${id}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { event?: ServiceEvent; error?: string };
  if (!res.ok) throw new Error(data.error || `Update ${res.status}`);
  if (!data.event) throw new Error("Update failed");
  return data.event;
}

export async function fetchServicePoints(q = ""): Promise<ServicePoint[]> {
  const res = await fetch(`/api/maintenance/service-points?q=${encodeURIComponent(q)}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { points?: ServicePoint[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Points ${res.status}`);
  return data.points || [];
}

export async function fetchMaintFieldUsers(): Promise<FieldUserOption[]> {
  const res = await fetch("/api/maintenance/field-users", {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { users?: FieldUserOption[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Field users ${res.status}`);
  return data.users || [];
}

export async function uploadMaintPhoto(eventId: string, dataUrl: string, caption = ""): Promise<ServicePhoto> {
  const res = await fetch(`/api/maintenance/events/${eventId}/photos`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({ dataUrl, caption }),
  });
  const data = (await res.json().catch(() => ({}))) as { photo?: ServicePhoto; error?: string };
  if (!res.ok) throw new Error(data.error || `Photo ${res.status}`);
  if (!data.photo) throw new Error("Upload failed");
  return data.photo;
}

export function eventVehicleLabel(ev: ServiceEvent): string {
  return ev.userDisplayName || ev.armadaUsername || (ev.armadaUserId ? `#${ev.armadaUserId}` : "—");
}

export function scheduleLabel(ev: ServiceEvent): string {
  const parts: string[] = [];
  if (ev.remindDueAt) {
    const d = new Date(ev.remindDueAt);
    if (Number.isFinite(d.getTime())) parts.push(`date ${d.toISOString().slice(0, 10)}`);
  }
  if (ev.remindIntervalDays != null && ev.remindIntervalDays > 0) {
    parts.push(`every ${ev.remindIntervalDays}d`);
  }
  if (ev.remindIntervalKm != null && ev.remindIntervalKm > 0) {
    parts.push(`every ${formatScheduleKm(ev.remindIntervalKm)} km`);
    if (ev.remindBaselineOdometerKm != null) {
      const next = ev.remindBaselineOdometerKm + ev.remindIntervalKm;
      parts.push(`next @ ${formatScheduleKm(next)} km`);
    }
  }
  if (ev.remindIntervalHours != null && ev.remindIntervalHours > 0) {
    parts.push(`every ${ev.remindIntervalHours}h ign-on`);
  }
  return parts.join(" · ");
}

function formatScheduleKm(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function eventWhen(ev: ServiceEvent, now = Date.now()): string {
  const ms = Date.parse(ev.createdAt);
  if (!Number.isFinite(ms)) return "—";
  return ageLabel(ms, now);
}

export async function fetchHoursAccrued(
  eventId: string,
  signal?: AbortSignal,
): Promise<{
  hoursAccrued: number | null;
  intervalHours: number | null;
  due: boolean;
  lookbackCapped: boolean;
  reason: string | null;
  daysLoaded?: number;
  daysRequested?: number;
  sinceAt?: string;
}> {
  const res = await fetch(`/api/maintenance/events/${eventId}/hours-accrued`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    hoursAccrued?: number | null;
    intervalHours?: number | null;
    due?: boolean;
    lookbackCapped?: boolean;
    reason?: string | null;
    daysLoaded?: number;
    daysRequested?: number;
    sinceAt?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Hours ${res.status}`);
  return {
    hoursAccrued: data.hoursAccrued ?? null,
    intervalHours: data.intervalHours ?? null,
    due: Boolean(data.due),
    lookbackCapped: Boolean(data.lookbackCapped),
    reason: data.reason ?? null,
    daysLoaded: data.daysLoaded,
    daysRequested: data.daysRequested,
    sinceAt: data.sinceAt,
  };
}

export async function fetchKmAccrued(
  eventId: string,
  signal?: AbortSignal,
): Promise<{
  kmAccrued: number | null;
  intervalKm: number | null;
  baselineKm: number | null;
  currentOdoKm: number | null;
  nextDueOdoKm: number | null;
  due: boolean;
  reason: string | null;
}> {
  const res = await fetch(`/api/maintenance/events/${eventId}/km-accrued`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    kmAccrued?: number | null;
    intervalKm?: number | null;
    baselineKm?: number | null;
    currentOdoKm?: number | null;
    nextDueOdoKm?: number | null;
    due?: boolean;
    reason?: string | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Km ${res.status}`);
  return {
    kmAccrued: data.kmAccrued ?? null,
    intervalKm: data.intervalKm ?? null,
    baselineKm: data.baselineKm ?? null,
    currentOdoKm: data.currentOdoKm ?? null,
    nextDueOdoKm: data.nextDueOdoKm ?? null,
    due: Boolean(data.due),
    reason: data.reason ?? null,
  };
}

export function emptyLine(): ServiceLine {
  return { kind: "part", description: "", qty: 1, unitPrice: null, unitCost: null, vendor: "" };
}

export function downloadMaintenanceExcel(events: ServiceEvent[]): void {
  const headers = [
    "Status",
    "Title",
    "Vehicle",
    "Username",
    "User ID",
    "Notes",
    "Service point",
    "Due date",
      "Interval days",
      "Interval km",
      "Interval hours",
      "Created",
    "Started",
    "Ended",
    "Odometer km",
    "Price total",
    "Cost total",
  ];
  const rows: ExcelCell[][] = [
    headers,
    ...events.map((ev) => [
      ev.status,
      ev.title,
      ev.userDisplayName,
      ev.armadaUsername,
      ev.armadaUserId ?? "",
      ev.notes,
      ev.servicePointName || "",
      ev.remindDueAt || "",
      ev.remindIntervalDays ?? "",
      ev.remindIntervalKm ?? "",
      ev.remindIntervalHours ?? "",
      ev.createdAt,
      ev.startedAt || "",
      ev.endedAt || "",
      ev.odometerKm ?? "",
      ev.priceTotal ?? "",
      ev.costTotal ?? "",
    ]),
  ];
  downloadXlsx(excelFilename("maintenance"), "Maintenance", rows);
}
