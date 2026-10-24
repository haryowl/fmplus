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
  rangeKind: "today",
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
