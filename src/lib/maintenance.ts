import { ageLabel } from "./lastStatus";
import { tenantHeaders } from "./tenant";
import { downloadXlsx, excelFilename, type ExcelCell } from "./xlsxDownload";

export type ServiceEventStatus = "due" | "in_progress" | "done" | "skipped";

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
  createdAt: string;
  updatedAt: string;
};

export type MaintenanceStatusFilter = ServiceEventStatus | "open" | "all";

export const SERVICE_STATUS_LABELS: Record<ServiceEventStatus, string> = {
  due: "Due",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
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

export async function createServiceEvent(body: {
  title: string;
  notes?: string;
  armadaUsername?: string;
  userDisplayName?: string;
  armadaUserId?: number | null;
  lat?: number | null;
  lon?: number | null;
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
  body: Partial<{ status: ServiceEventStatus; notes: string; odometerKm: number | null }>,
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

export function eventVehicleLabel(ev: ServiceEvent): string {
  return ev.userDisplayName || ev.armadaUsername || (ev.armadaUserId ? `#${ev.armadaUserId}` : "—");
}

export function eventWhen(ev: ServiceEvent, now = Date.now()): string {
  const ms = Date.parse(ev.createdAt);
  if (!Number.isFinite(ms)) return "—";
  return ageLabel(ms, now);
}

export function downloadMaintenanceExcel(events: ServiceEvent[]): void {
  const headers = [
    "Status",
    "Title",
    "Vehicle",
    "Username",
    "User ID",
    "Notes",
    "Created",
    "Started",
    "Ended",
    "Odometer km",
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
      ev.createdAt,
      ev.startedAt || "",
      ev.endedAt || "",
      ev.odometerKm ?? "",
    ]),
  ];
  downloadXlsx(excelFilename("maintenance"), "Maintenance", rows);
}
