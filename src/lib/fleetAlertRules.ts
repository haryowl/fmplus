import { tenantHeaders } from "./tenant";

export type AlertCondition = {
  field: string;
  cmp: string;
  value: string | number | boolean;
};

export type AlertFormula = {
  op: "and" | "or";
  conditions: AlertCondition[];
  durationSec?: number;
};

export type FleetAlertRule = {
  id: string;
  name: string;
  enabled: boolean;
  severity: "info" | "warning" | "critical";
  scopeKind: "all" | "group" | "devices";
  scopeGroupId: string | null;
  scopeDeviceIds: string[];
  formula: AlertFormula;
  notifyEmail: boolean;
  notifyWhatsapp: boolean;
  cooldownSec: number;
};

export type FleetRuleEvent = {
  id: string;
  ruleId: string | null;
  ruleName: string;
  deviceId: string | null;
  deviceLabel: string;
  severity: string;
  title: string;
  detail: string;
  status: string;
  firedAt: string;
  notifyEmailSent?: boolean;
  notifyWhatsappSent?: boolean;
};

export type FleetRuleHold = {
  ruleId: string;
  ruleName: string;
  deviceId: string;
  deviceLabel: string;
  severity: string;
  trueSince: string;
  heldSec: number;
  durationSec: number;
  progress: number;
  phase: "holding" | "cooldown" | "ready";
  cooldownSec: number;
  lastEvalAt?: string;
  lastFiredAt?: string | null;
};

export const RULE_FIELDS = [
  { value: "speed", label: "Speed (km/h)" },
  { value: "ignition", label: "Ignition" },
  { value: "age_sec", label: "Age (sec)" },
  { value: "fuel_level", label: "Fuel level %" },
  { value: "odometer_km", label: "Odometer km" },
  { value: "heading", label: "Heading" },
] as const;

export const RULE_CMPS = [">", ">=", "<", "<=", "==", "!=", "in", "contains"] as const;

/** True when the field is a free-form mapped.* key (not a cooked snap field). */
export function isMappedField(field: string): boolean {
  return String(field || "").startsWith("mapped.");
}

async function parseJson(res: Response) {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function fetchAlertRules(signal?: AbortSignal): Promise<FleetAlertRule[]> {
  const res = await fetch("/api/tracker/alert-rules", {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Rules ${res.status}`));
  return Array.isArray(data.rules) ? (data.rules as FleetAlertRule[]) : [];
}

export async function saveAlertRule(
  body: Partial<FleetAlertRule> & { name: string; formula: AlertFormula },
  id?: string,
): Promise<FleetAlertRule> {
  const res = await fetch(id ? `/api/tracker/alert-rules/${id}` : "/api/tracker/alert-rules", {
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
  return data.rule as FleetAlertRule;
}

export async function deleteAlertRule(id: string): Promise<void> {
  const res = await fetch(`/api/tracker/alert-rules/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Delete ${res.status}`));
}

export async function fetchRuleEvents(
  opts?: { status?: string; limit?: number },
  signal?: AbortSignal,
): Promise<FleetRuleEvent[]> {
  const q = new URLSearchParams();
  if (opts?.status) q.set("status", opts.status);
  if (opts?.limit) q.set("limit", String(opts.limit));
  const res = await fetch(`/api/tracker/alert-events?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Events ${res.status}`));
  return Array.isArray(data.events) ? (data.events as FleetRuleEvent[]) : [];
}

export async function fetchRuleHolds(
  opts?: { limit?: number },
  signal?: AbortSignal,
): Promise<FleetRuleHold[]> {
  const q = new URLSearchParams();
  if (opts?.limit) q.set("limit", String(opts.limit));
  const res = await fetch(`/api/tracker/alert-holds?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Holds ${res.status}`));
  return Array.isArray(data.holds) ? (data.holds as FleetRuleHold[]) : [];
}

export function formatHoldClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export async function ackRuleEvent(id: string): Promise<void> {
  const res = await fetch(`/api/tracker/alert-events/${id}/ack`, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Ack ${res.status}`));
}

export async function resolveRuleEvent(id: string): Promise<void> {
  const res = await fetch(`/api/tracker/alert-events/${id}/resolve`, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(String(data.error || `Resolve ${res.status}`));
}
