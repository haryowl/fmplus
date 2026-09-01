import { DEFAULT_TZ } from "./config";
import type { Period } from "./types";

export const EMBED_SET = "fms-embed:set";
export const EMBED_READY = "fms-embed:ready";

const AUTH_PARAM = /^(auth|authorization|token|api[_-]?key|armada[_-]?auth|auth[_-]?header)$/i;

export type EmbedConfig = {
  compact: boolean;
  groupId: string;
  userId: string;
  from: string;
  to: string;
  tz: string;
  period: Period;
  lock: {
    group: boolean;
    user: boolean;
    from: boolean;
    to: boolean;
    tz: boolean;
  };
};

export function allowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function originAllowed(eventOrigin: string, allowlist: string[], selfOrigin: string): boolean {
  if (allowlist.length > 0) return allowlist.includes(eventOrigin);
  return eventOrigin === selfOrigin;
}

function idParam(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d+$/.test(value) ? value : "";
}

function dateParam(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function periodParam(value: string | null | undefined): Period {
  if (value === "weekly" || value === "monthly" || value === "daily") return value;
  return "daily";
}

function tzParam(value: string | null | undefined): string {
  if (!value) return DEFAULT_TZ;
  // Query strings treat "+" as space, so tz=+07:00 arrives as "07:00".
  const trimmed = value.trim();
  const normalized = /^[+-]\d{2}:\d{2}$/.test(trimmed)
    ? trimmed
    : /^\d{2}:\d{2}$/.test(trimmed)
      ? `+${trimmed}`
      : trimmed;
  return /^[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : DEFAULT_TZ;
}

function compactFlag(value: string | boolean | null | undefined): boolean {
  return value === true || value === "1" || value === "true";
}

/** Host context only. Auth query keys are dropped and never returned. */
export function parseEmbedSearch(search: string): EmbedConfig {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  for (const key of [...params.keys()]) {
    if (AUTH_PARAM.test(key)) params.delete(key);
  }

  const groupId = idParam(params.get("groupId"));
  const userId = idParam(params.get("userId"));
  const from = dateParam(params.get("from"));
  const to = dateParam(params.get("to"));

  return {
    compact: compactFlag(params.get("embed")),
    groupId,
    userId,
    from,
    to,
    tz: tzParam(params.get("tz")),
    period: periodParam(params.get("period")),
    lock: {
      group: Boolean(groupId),
      user: Boolean(userId),
      from: Boolean(from),
      to: Boolean(to),
      tz: params.has("tz"),
    },
  };
}

export function parseHostMessage(
  data: unknown,
  eventOrigin: string,
  allowlist: string[],
  selfOrigin: string,
): EmbedConfig | null {
  if (!originAllowed(eventOrigin, allowlist, selfOrigin)) return null;
  if (!data || typeof data !== "object") return null;
  const msg = data as Record<string, unknown>;
  if (msg.type !== EMBED_SET) return null;

  const pick = (key: string): string | undefined => {
    if (AUTH_PARAM.test(key)) return undefined;
    const value = msg[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  };

  const groupId = idParam(pick("groupId"));
  const userId = idParam(pick("userId"));
  const from = dateParam(pick("from"));
  const to = dateParam(pick("to"));
  const tzRaw = pick("tz");

  return {
    compact: msg.embed === undefined ? true : compactFlag(msg.embed as string | boolean | undefined),
    groupId,
    userId,
    from,
    to,
    tz: tzParam(tzRaw),
    period: periodParam(pick("period")),
    lock: {
      group: Boolean(groupId),
      user: Boolean(userId),
      from: Boolean(from),
      to: Boolean(to),
      tz: tzRaw !== undefined,
    },
  };
}
