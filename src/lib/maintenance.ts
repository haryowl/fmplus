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

export function eventWhen(ev: ServiceEvent, now = Date.now()): string {
  const ms = Date.parse(ev.createdAt);
  if (!Number.isFinite(ms)) return "—";
  return ageLabel(ms, now);
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
