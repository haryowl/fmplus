import { ageLabel, type LastStatusRow } from "./lastStatus";
import { STALE_MS } from "./liveOps";
import { tenantHeaders } from "./tenant";
import { downloadXlsx, excelFilename, type ExcelCell } from "./xlsxDownload";

export type ExceptionItem = {
  id: string;
  kind: string;
  ruleName: string;
  eventTime: string | null;
  armadaUsername: string;
  userDisplayName: string;
  lat: number | null;
  lon: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
  ackedAt: string | null;
  ackedNote: string;
  source: "notify" | "derived";
  /** Present on derived stale rows */
  userId?: number;
};

export type ExceptionStatusFilter = "open" | "acked" | "all";

export async function fetchExceptions(
  status: ExceptionStatusFilter = "open",
  signal?: AbortSignal,
): Promise<ExceptionItem[]> {
  const res = await fetch(`/api/exceptions?status=${encodeURIComponent(status)}&limit=100`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { exceptions?: ExceptionItem[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Exceptions ${res.status}`);
  return (data.exceptions || []).map((row) => ({ ...row, source: "notify" as const }));
}

export async function ackException(id: string, note = ""): Promise<ExceptionItem> {
  const res = await fetch(`/api/exceptions/${id}/ack`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({ note }),
  });
  const data = (await res.json().catch(() => ({}))) as { exception?: ExceptionItem; error?: string };
  if (!res.ok) throw new Error(data.error || `Ack ${res.status}`);
  if (!data.exception) throw new Error("Ack failed");
  return { ...data.exception, source: "notify" };
}

export async function unackException(id: string): Promise<ExceptionItem> {
  const res = await fetch(`/api/exceptions/${id}/unack`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as { exception?: ExceptionItem; error?: string };
  if (!res.ok) throw new Error(data.error || `Unack ${res.status}`);
  if (!data.exception) throw new Error("Unack failed");
  return { ...data.exception, source: "notify" };
}

/** Secondary feed: stale vehicles from last status (not persisted). */
export function derivedStaleExceptions(rows: LastStatusRow[], now = Date.now()): ExceptionItem[] {
  return rows
    .filter((row) => row.lastMs !== null && now - row.lastMs > STALE_MS)
    .map((row) => ({
      id: `derived-stale-${row.id}`,
      kind: "exception",
      ruleName: "Derived: Stale position",
      eventTime: row.utc || null,
      armadaUsername: row.username,
      userDisplayName: row.name,
      lat: row.lat,
      lon: row.lon,
      payload: {},
      createdAt: new Date(row.lastMs ?? now).toISOString(),
      ackedAt: null,
      ackedNote: "",
      source: "derived" as const,
      userId: row.id,
    }));
}

export function exceptionTitle(item: ExceptionItem): string {
  return item.ruleName || "Exception";
}

export function exceptionWhen(item: ExceptionItem, now = Date.now()): string {
  const ms = item.eventTime ? Date.parse(item.eventTime) : Date.parse(item.createdAt);
  if (!Number.isFinite(ms)) return "—";
  return ageLabel(ms, now);
}

export function exceptionUserId(item: ExceptionItem): number | null {
  if (item.userId) return item.userId;
  const p = item.payload || {};
  const raw = p.USER_ID ?? p.userId ?? p.UserId;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Scope notifier/derived rows to a group (or tenant allowlist). */
export function filterExceptionsByGroup(
  items: ExceptionItem[],
  opts?: { userIds?: number[]; usernames?: string[] },
): ExceptionItem[] {
  const ids = opts?.userIds?.length ? new Set(opts.userIds) : null;
  const names = opts?.usernames?.length
    ? new Set(opts.usernames.map((u) => u.trim().toLowerCase()).filter(Boolean))
    : null;
  if (!ids && !names) return items;
  return items.filter((item) => {
    const uid = exceptionUserId(item);
    if (uid != null && ids?.has(uid)) return true;
    const un = (item.armadaUsername || "").trim().toLowerCase();
    if (un && names?.has(un)) return true;
    return false;
  });
}

export function downloadExceptionsExcel(items: ExceptionItem[], now = Date.now()): void {
  const headers: ExcelCell[] = [
    "Source",
    "Status",
    "Rule",
    "When",
    "Vehicle",
    "Username",
    "User ID",
    "Lat",
    "Lon",
    "Acked note",
  ];
  const body: ExcelCell[][] = items.map((item) => [
    item.source === "derived" ? "Derived" : "Notifier",
    item.ackedAt ? "Acked" : "Open",
    exceptionTitle(item),
    exceptionWhen(item, now),
    item.userDisplayName || "",
    item.armadaUsername || "",
    exceptionUserId(item) ?? "",
    item.lat == null ? "" : Math.round(item.lat * 1e6) / 1e6,
    item.lon == null ? "" : Math.round(item.lon * 1e6) / 1e6,
    item.ackedNote || "",
  ]);
  downloadXlsx(excelFilename("exceptions"), "Exceptions", [headers, ...body]);
}
