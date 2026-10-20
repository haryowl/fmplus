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
};

export const RULE_FIELDS = [
  { value: "speed", label: "Speed (km/h)" },
  { value: "ignition", label: "Ignition" },
  { value: "age_sec", label: "Age (sec)" },
  { value: "fuel_level", label: "Fuel level %" },
  { value: "odometer_km", label: "Odometer km" },
  { value: "heading", label: "Heading" },
] as const;

export const RULE_CMPS = [">", ">=", "<", "<=", "==", "!="] as const;

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
