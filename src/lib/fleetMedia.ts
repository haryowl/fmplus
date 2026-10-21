import { tenantHeaders } from "./tenant";

export type FleetMediaKind = "picture" | "video" | "audio" | "other";

export type FleetMediaEvent = {
  id: string;
  deviceId: string;
  deviceLabel?: string;
  imei?: string;
  protocol?: string;
  recordedAt: string;
  alarmType: string;
  alarmLevel: number;
  lat: number | null;
  lon: number | null;
  attachmentId: string;
  sourceProtocol?: string;
  mediaKind: FleetMediaKind;
  mediaChannel?: number | null;
  mediaId?: number | string | null;
  mappedAttrs?: Record<string, unknown>;
  eventClass?: "safety" | "warning" | "asset" | "none";
  raiseAlert?: boolean;
};

export type FleetMediaResponse = {
  events: FleetMediaEvent[];
  mediaCapableCount?: number;
};

export function attachmentIsUrl(id: string): boolean {
  return /^https?:\/\//i.test(String(id || "").trim());
}

export async function fetchFleetMedia(
  opts: {
    kind?: "picture" | "video" | "audio" | "all";
    deviceId?: string;
    groupId?: string;
    from?: string;
    to?: string;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<FleetMediaResponse> {
  const q = new URLSearchParams();
  if (opts.kind && opts.kind !== "all") q.set("kind", opts.kind);
  if (opts.deviceId) q.set("deviceId", opts.deviceId);
  if (opts.groupId) q.set("groupId", opts.groupId);
  if (opts.from) q.set("from", opts.from);
  if (opts.to) q.set("to", opts.to);
  if (opts.limit) q.set("limit", String(opts.limit));
  const res = await fetch(`/api/tracker/media?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as FleetMediaResponse & { error?: string };
  if (!res.ok) throw new Error(data.error || `Media ${res.status}`);
  return {
    events: Array.isArray(data.events) ? data.events : [],
    mediaCapableCount: data.mediaCapableCount,
  };
}

export async function fetchFleetAlerts(
  opts: {
    deviceId?: string;
    groupId?: string;
    from?: string;
    to?: string;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<FleetMediaEvent[]> {
  const q = new URLSearchParams();
  if (opts.deviceId) q.set("deviceId", opts.deviceId);
  if (opts.groupId) q.set("groupId", opts.groupId);
  if (opts.from) q.set("from", opts.from);
  if (opts.to) q.set("to", opts.to);
  q.set("limit", String(opts.limit || 100));
  const res = await fetch(`/api/tracker/safety-events?${q}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    events?: FleetMediaEvent[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Alerts ${res.status}`);
  return data.events || [];
}

export function alarmLabel(type: string): string {
  return String(type || "alert")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
