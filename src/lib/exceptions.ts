import { ageLabel, type LastStatusRow } from "./lastStatus";
import { STALE_MS } from "./liveOps";
import { tenantHeaders } from "./tenant";

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
