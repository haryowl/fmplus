import { tenantHeaders } from "./tenant";

export type ReportGrain = "fixes" | "daily";
export type ReportRangeKind = "today" | "last7" | "last30" | "custom";
export type ReportScopeKind = "all" | "group" | "devices";

export type ReportFilter = {
  field: string;
  cmp: string;
  value: string | number | boolean;
};

export type ReportSpec = {
  grain: ReportGrain;
  rangeKind: ReportRangeKind;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  scopeKind: ReportScopeKind;
  scopeGroupId: string | null;
  scopeDeviceIds: string[];
  columns: string[];
  format: "csv" | "xlsx";
  filters: ReportFilter[];
};

export type FleetReport = {
  id: string;
  name: string;
  enabled: boolean;
  source: string;
  spec: ReportSpec;
  recipients: string;
  ccTenantNotify: boolean;
  scheduleKind: "off" | "daily" | "weekly";
  scheduleHour: number;
  scheduleWeekday: number;
  lastRunAt: string | null;
  lastError: string;
};

export type ReportColumn = { id: string; label: string };

export type ReportColCategory = "essential" | "location" | "power" | "io" | "gnss" | "system";

export const REPORT_COL_CATEGORIES: { id: ReportColCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "essential", label: "Essential" },
  { id: "location", label: "Location & Motion" },
  { id: "power", label: "Power & Battery" },
  { id: "io", label: "Inputs/Outputs" },
  { id: "gnss", label: "GNSS" },
  { id: "system", label: "System" },
];

export const ESSENTIAL_FIX_IDS = [
  "device",
  "imei",
  "recorded_at",
  "lat",
  "lon",
  "speed",
  "ignition",
] as const;

export const LOCATION_FIX_IDS = ["heading", "odometer_km", "altitude"] as const;

export function reportColumnKey(id: string): string {
  return String(id || "").startsWith("mapped.") ? String(id).slice(7) : String(id || "");
}

export function categorizeReportColumn(
  id: string,
  grain: ReportGrain = "fixes",
): ReportColCategory {
  const key = reportColumnKey(id).toLowerCase();
  if (grain === "daily") {
    if (["device", "imei", "date", "fix_count"].includes(id)) return "essential";
    if (
      ["avg_speed", "max_speed", "first_at", "last_at", "odo_start", "odo_end", "ignition_on"].includes(
        id,
      )
    ) {
      return "location";
    }
    return "system";
  }
  if ((ESSENTIAL_FIX_IDS as readonly string[]).includes(id)) return "essential";
  if ((LOCATION_FIX_IDS as readonly string[]).includes(id)) return "location";
  if (/(battery|voltage|power|ext.?volt|\bbatt\b|fuel)/.test(key)) return "power";
  if (/(^|[._-])(din|dout|ain|dio|io|input|output)(\d|[._-]|$)/.test(key)) return "io";
  if (/(lat|lon|heading|altitude|odometer|moving|movement|speed|ignition|status\.acc)/.test(key)) {
    return "location";
  }
  if (/(gnss|gps|satellit|hdop|pdop|vdop)/.test(key)) return "gnss";
  return "system";
}

export function parseReportEmails(raw: string): string[] {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

export function formatReportBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ReportEstimate = {
  rows: number;
  bytes: number;
  range: { from: string; to: string; timezone: string };
};

export type ReportRunResult = {
  columns: string[];
  headers: string[];
  rows: Array<Array<string | number | boolean | null>>;
  rowCount: number;
  truncated: boolean;
  range: { from: string; to: string; timezone: string };
  grain: ReportGrain;
};

export const DEFAULT_REPORT_SPEC: ReportSpec = {
  grain: "fixes",
  rangeKind: "last7",
  dateFrom: "",
  dateTo: "",
  timezone: "+07:00",
  scopeKind: "all",
  scopeGroupId: null,
  scopeDeviceIds: [],
  columns: ["device", "recorded_at", "lat", "lon", "speed", "ignition"],
  format: "csv",
  filters: [],
};

async function parseJson(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function fetchFleetReports(signal?: AbortSignal): Promise<FleetReport[]> {
  const res = await fetch("/api/tracker/reports", {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Reports ${res.status}`));
  return Array.isArray(data.reports) ? (data.reports as FleetReport[]) : [];
}

export async function saveFleetReport(
  body: Partial<FleetReport> & { name: string; spec: ReportSpec },
  id?: string,
): Promise<FleetReport> {
  const res = await fetch(id ? `/api/tracker/reports/${id}` : "/api/tracker/reports", {
    method: id ? "PUT" : "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...tenantHeaders(),
    },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Save ${res.status}`));
  return data.report as FleetReport;
}

export async function deleteFleetReport(id: string): Promise<void> {
  const res = await fetch(`/api/tracker/reports/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Delete ${res.status}`));
}

export async function fetchReportColumns(
  spec: Partial<ReportSpec>,
  signal?: AbortSignal,
): Promise<ReportColumn[]> {
  const res = await fetch("/api/tracker/reports/columns", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...tenantHeaders(),
    },
    body: JSON.stringify({ spec }),
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Columns ${res.status}`));
  return Array.isArray(data.columns) ? (data.columns as ReportColumn[]) : [];
}

export async function estimateFleetReport(
  spec: Partial<ReportSpec>,
  signal?: AbortSignal,
): Promise<ReportEstimate> {
  const res = await fetch("/api/tracker/reports/estimate", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...tenantHeaders(),
    },
    body: JSON.stringify({ spec }),
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Estimate ${res.status}`));
  return {
    rows: Number(data.rows) || 0,
    bytes: Number(data.bytes) || 0,
    range:
      data.range && typeof data.range === "object"
        ? (data.range as ReportEstimate["range"])
        : { from: "", to: "", timezone: "" },
  };
}

export async function runFleetReport(
  spec: ReportSpec,
  opts?: { limit?: number },
): Promise<ReportRunResult> {
  const res = await fetch("/api/tracker/reports/run", {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...tenantHeaders(),
    },
    body: JSON.stringify({ spec, limit: opts?.limit }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Run ${res.status}`));
  return data as unknown as ReportRunResult;
}
