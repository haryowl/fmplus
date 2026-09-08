import { ageLabel } from "./lastStatus";
import { tenantHeaders } from "./tenant";
import { downloadXlsx, excelFilename, type ExcelCell } from "./xlsxDownload";

export type ServiceEventStatus = "due" | "in_progress" | "done" | "skipped" | "approved";
export type ScheduleHealth = "none" | "ok" | "upcoming" | "due" | "overdue" | "completed";
export type LineKind = "part" | "service" | "other" | "labor";

export type ServiceLine = {
  id?: string;
  kind: LineKind;
  catalogItemId?: string | null;
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
  /** Minutes from Start → Done (or Skip), when both timestamps exist. */
  serviceDurationMinutes?: number | null;
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
  remindBeforeDays?: number | null;
  remindBeforeKm?: number | null;
  remindBeforeHours?: number | null;
  parentEventId?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  scheduleHealth?: ScheduleHealth;
  scheduleBits?: string[];
  scheduleUrgency?: number;
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

export type MaintenanceStatusFilter = ServiceEventStatus | "open" | "all" | "completed";
export type MaintenanceBoardView =
  | "attention"
  | "upcoming"
  | "due"
  | "overdue"
  | "completed"
  | MaintenanceStatusFilter;

export type ScheduleSummary = {
  upcoming: number;
  due: number;
  overdue: number;
  completed: number;
  approved?: number;
  awaitingApprove?: number;
  ok: number;
  none: number;
  open: number;
  /** Average Start→Done minutes over recent completed jobs (when available). */
  avgServiceMinutes?: number | null;
  serviceTimeSamples?: number;
};

export function formatServiceDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export type ScheduleHealthBars = {
  labels: string[];
  values: number[];
  keys: string[];
};

export type ScheduleTimeline = {
  days: number;
  labels: string[];
  completed: number[];
  opened: number[];
};

export type ScheduleDashboard = {
  summary: ScheduleSummary;
  healthBars?: ScheduleHealthBars;
  timeline?: ScheduleTimeline;
};

export const SERVICE_STATUS_LABELS: Record<ServiceEventStatus, string> = {
  due: "Due",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
  approved: "Approved",
};

export const SCHEDULE_HEALTH_LABELS: Record<ScheduleHealth, string> = {
  none: "Unscheduled",
  ok: "On track",
  upcoming: "Upcoming",
  due: "Due",
  overdue: "Overdue",
  completed: "Completed",
};

export const LINE_KIND_LABELS: Record<"part" | "service" | "other", string> = {
  part: "Part",
  service: "Service",
  other: "Others",
};

export type CatalogItem = {
  id: string;
  groupId: string;
  groupKey: string;
  name: string;
  unitPrice: number | null;
  unitCost: number | null;
  enabled: boolean;
  sortOrder: number;
};

export type CatalogGroup = {
  id: string;
  key: "part" | "service" | "other" | string;
  name: string;
  sortOrder: number;
  items: CatalogItem[];
};

export type MaintStatusCell = {
  label: string;
  status: string | null;
  health: string;
  eventId: string | null;
  title: string;
};

export type CostDashboard = {
  days: number;
  totals: { price: number; cost: number; margin: number; jobs: number };
  byDay: { day: string; price: number; cost: number; count: number }[];
  byVehicle: { label: string; userId: number | null; price: number; cost: number; count: number }[];
  byGroup: Record<string, { price: number; cost: number }>;
  topItems: { name: string; kind: string; price: number; cost: number; qty: number }[];
  table: {
    id: string;
    title: string;
    vehicle: string;
    armadaUserId: number | null;
    approvedAt: string | null;
    approvedBy: string;
    serviceDurationMinutes: number | null;
    priceTotal: number | null;
    costTotal: number | null;
    margin: number | null;
  }[];
};

export async function fetchServiceEvents(
  status: MaintenanceStatusFilter = "open",
  signal?: AbortSignal,
  opts?: { health?: Exclude<ScheduleHealth, "completed"> | "" },
): Promise<{ events: ServiceEvent[]; summary?: ScheduleSummary }> {
  const params = new URLSearchParams({ status, limit: "100" });
  if (opts?.health) params.set("health", opts.health);
  const res = await fetch(`/api/maintenance/events?${params}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    events?: ServiceEvent[];
    summary?: ScheduleSummary;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Maintenance ${res.status}`);
  return { events: data.events || [], summary: data.summary };
}

export async function fetchScheduleSummary(signal?: AbortSignal): Promise<ScheduleDashboard> {
  const res = await fetch("/api/maintenance/schedule-summary", {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    summary?: ScheduleSummary;
    healthBars?: ScheduleHealthBars;
    timeline?: ScheduleTimeline;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Summary ${res.status}`);
  return {
    summary: data.summary || {
      upcoming: 0,
      due: 0,
      overdue: 0,
      completed: 0,
      approved: 0,
      awaitingApprove: 0,
      ok: 0,
      none: 0,
      open: 0,
      avgServiceMinutes: null,
      serviceTimeSamples: 0,
    },
    healthBars: data.healthBars,
    timeline: data.timeline,
  };
}

export async function fetchMaintenanceCatalog(signal?: AbortSignal): Promise<CatalogGroup[]> {
  const res = await fetch("/api/maintenance/catalog", {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { groups?: CatalogGroup[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Catalog ${res.status}`);
  return data.groups || [];
}

export async function createMaintCatalogItem(body: {
  groupId: string;
  name: string;
  unitPrice?: number | null;
  unitCost?: number | null;
}): Promise<CatalogItem> {
  const res = await fetch("/api/maintenance/catalog/items", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { item?: CatalogItem; error?: string };
  if (!res.ok) throw new Error(data.error || `Create item ${res.status}`);
  if (!data.item) throw new Error("Create failed");
  return data.item;
}

export async function patchMaintCatalogItem(
  id: string,
  body: Record<string, unknown>,
): Promise<CatalogItem> {
  const res = await fetch(`/api/maintenance/catalog/items/${id}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { item?: CatalogItem; error?: string };
  if (!res.ok) throw new Error(data.error || `Update item ${res.status}`);
  if (!data.item) throw new Error("Update failed");
  return data.item;
}

export async function deleteMaintCatalogItem(id: string): Promise<void> {
  const res = await fetch(`/api/maintenance/catalog/items/${id}`, {
    method: "DELETE",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Delete ${res.status}`);
}

export async function fetchCostDashboard(
  opts?: { days?: number; userId?: number; group?: string },
  signal?: AbortSignal,
): Promise<CostDashboard> {
  const params = new URLSearchParams();
  if (opts?.days) params.set("days", String(opts.days));
  if (opts?.userId) params.set("userId", String(opts.userId));
  if (opts?.group) params.set("group", opts.group);
  const res = await fetch(`/api/maintenance/cost-dashboard?${params}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as CostDashboard & { error?: string };
  if (!res.ok) throw new Error(data.error || `Cost dashboard ${res.status}`);
  return data;
}

export type AnalyzeSummary = {
  days: number;
  workflow: {
    due: number;
    in_progress: number;
    done: number;
    approved: number;
    skipped: number;
    open: number;
  };
  schedule: {
    upcoming: number;
    due: number;
    overdue: number;
    ok: number;
    none: number;
    open: number;
  };
  assignment: {
    openAssigned: number;
    openUnassigned: number;
    unassignedFollowUps: number;
  };
  pipeline: { jobs: number; price: number; cost: number; margin: number };
  approved: {
    jobs: number;
    price: number;
    cost: number;
    margin: number;
    avgServiceMinutes: number | null;
  };
  reminders: {
    openTotal: number;
    openByKind: {
      due_soon: number;
      overdue: number;
      next_due: number;
      assigned: number;
    };
    ackedInPeriod: number;
    sendErrors: number;
  };
  quality: {
    closedInPeriod: number;
    withPhotos: number;
    withLines: number;
    photoRate: number | null;
    lineRate: number | null;
  };
  aging: { label: string; count: number }[];
  byAssignee: {
    id: string | null;
    name: string;
    open: number;
    done: number;
    approved: number;
    avgMinutes: number | null;
  }[];
  timeline: ScheduleTimeline;
  healthBars: ScheduleHealthBars;
};

export async function fetchAnalyzeSummary(
  days = 90,
  signal?: AbortSignal,
): Promise<AnalyzeSummary> {
  const params = new URLSearchParams({ days: String(days) });
  const res = await fetch(`/api/maintenance/analyze-summary?${params}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as AnalyzeSummary & { error?: string };
  if (!res.ok) throw new Error(data.error || `Analyze summary ${res.status}`);
  return data;
}

export async function fetchMaintStatusSummary(
  userIds: number[],
  signal?: AbortSignal,
): Promise<Record<string, MaintStatusCell>> {
  if (!userIds.length) return {};
  const params = new URLSearchParams({ userIds: userIds.join(",") });
  const res = await fetch(`/api/maintenance/status-summary?${params}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    byUserId?: Record<string, MaintStatusCell>;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Status summary ${res.status}`);
  return data.byUserId || {};
}

export function normalizeLineKindUi(kind: string): "part" | "service" | "other" {
  if (kind === "labor" || kind === "service") return "service";
  if (kind === "part") return "part";
  return "other";
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
  remindBeforeDays?: number | null;
  remindBeforeKm?: number | null;
  remindBeforeHours?: number | null;
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
): Promise<{ event: ServiceEvent; nextEvent: ServiceEvent | null }> {
  const res = await fetch(`/api/maintenance/events/${id}`, {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    event?: ServiceEvent;
    nextEvent?: ServiceEvent | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Update ${res.status}`);
  if (!data.event) throw new Error("Update failed");
  return { event: data.event, nextEvent: data.nextEvent || null };
}

export async function deleteServiceEvent(id: string): Promise<void> {
  const res = await fetch(`/api/maintenance/events/${id}`, {
    method: "DELETE",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Delete ${res.status}`);
}

export type MaintenanceReminder = {
  id: string;
  eventId: string | null;
  kind: string;
  channel: string;
  recipient: string;
  title: string;
  body: string;
  ackedAt: string | null;
  sentAt: string | null;
  error: string;
  createdAt: string;
};

export async function fetchMaintReminders(
  status: "open" | "acked" | "all" = "open",
  signal?: AbortSignal,
): Promise<MaintenanceReminder[]> {
  const res = await fetch(`/api/maintenance/reminders?status=${status}&limit=50`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    reminders?: MaintenanceReminder[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Reminders ${res.status}`);
  return data.reminders || [];
}

export async function ackMaintReminder(id: string): Promise<MaintenanceReminder> {
  const res = await fetch(`/api/maintenance/reminders/${id}/ack`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as {
    reminder?: MaintenanceReminder;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Ack ${res.status}`);
  if (!data.reminder) throw new Error("Ack failed");
  return data.reminder;
}

export async function evaluateMaintReminders(): Promise<{ checked: number; emitted: number }> {
  const res = await fetch("/api/maintenance/reminders/evaluate", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as {
    checked?: number;
    emitted?: number;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Evaluate ${res.status}`);
  return { checked: data.checked || 0, emitted: data.emitted || 0 };
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
  return {
    kind: "part",
    catalogItemId: null,
    description: "",
    qty: 1,
    unitPrice: null,
    unitCost: null,
    vendor: "",
  };
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

function pctCell(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "";
  return `${(rate * 100).toFixed(1)}%`;
}

export function downloadAnalyzeReportExcel(
  data: AnalyzeSummary,
  fleet?: { vehicles: number; withOpen: number; withOverdue: number } | null,
): void {
  const kind = data.reminders.openByKind;
  const rows: ExcelCell[][] = [
    ["Maintenance Analyze Report", `Last ${data.days} days`],
    [],
    ["Section", "Metric", "Value"],
    ["Workflow", "Open", data.workflow.open],
    ["Workflow", "Due", data.workflow.due],
    ["Workflow", "In progress", data.workflow.in_progress],
    ["Workflow", "Done (awaiting approve)", data.workflow.done],
    ["Workflow", "Approved (all)", data.workflow.approved],
    ["Workflow", "Skipped", data.workflow.skipped],
    ["Schedule", "Upcoming", data.schedule.upcoming],
    ["Schedule", "Due", data.schedule.due],
    ["Schedule", "Overdue", data.schedule.overdue],
    ["Schedule", "On track", data.schedule.ok],
    ["Schedule", "Unscheduled", data.schedule.none],
    ["Assignment", "Open assigned", data.assignment.openAssigned],
    ["Assignment", "Open unassigned", data.assignment.openUnassigned],
    ["Assignment", "Unassigned follow-ups", data.assignment.unassignedFollowUps],
    ["Pipeline (done)", "Jobs", data.pipeline.jobs],
    ["Pipeline (done)", "Est. price", data.pipeline.price],
    ["Pipeline (done)", "Est. cost", data.pipeline.cost],
    ["Pipeline (done)", "Est. margin", data.pipeline.margin],
    ["Approved (period)", "Jobs", data.approved.jobs],
    ["Approved (period)", "Price", data.approved.price],
    ["Approved (period)", "Cost", data.approved.cost],
    ["Approved (period)", "Margin", data.approved.margin],
    ["Approved (period)", "Avg service minutes", data.approved.avgServiceMinutes ?? ""],
    ["Reminders", "Open total", data.reminders.openTotal],
    ["Reminders", "Due soon", kind.due_soon],
    ["Reminders", "Overdue", kind.overdue],
    ["Reminders", "Next due", kind.next_due],
    ["Reminders", "Assigned", kind.assigned],
    ["Reminders", "Acked in period", data.reminders.ackedInPeriod],
    ["Reminders", "Send errors in period", data.reminders.sendErrors],
    ["Quality", "Closed in period", data.quality.closedInPeriod],
    ["Quality", "With photos", data.quality.withPhotos],
    ["Quality", "With lines", data.quality.withLines],
    ["Quality", "Photo rate", pctCell(data.quality.photoRate)],
    ["Quality", "Line rate", pctCell(data.quality.lineRate)],
  ];
  if (fleet) {
    rows.push(
      ["Fleet", "Vehicles in scope", fleet.vehicles],
      ["Fleet", "With open maintenance", fleet.withOpen],
      ["Fleet", "With overdue", fleet.withOverdue],
      [
        "Fleet",
        "Open %",
        fleet.vehicles ? pctCell(fleet.withOpen / fleet.vehicles) : "",
      ],
      [
        "Fleet",
        "Overdue %",
        fleet.vehicles ? pctCell(fleet.withOverdue / fleet.vehicles) : "",
      ],
    );
  }
  rows.push([], ["Aging bucket", "Count"]);
  for (const b of data.aging) rows.push([b.label, b.count]);
  rows.push([], ["Assignee", "Open", "Done (period)", "Approved (period)", "Avg minutes"]);
  for (const a of data.byAssignee) {
    rows.push([a.name, a.open, a.done, a.approved, a.avgMinutes ?? ""]);
  }
  downloadXlsx(excelFilename("maintenance-analyze"), "Analyze", rows);
}
