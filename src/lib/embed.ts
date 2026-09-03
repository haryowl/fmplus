import { DEFAULT_TZ } from "./config";
import type { Period } from "./types";

export const EMBED_SET = "fms-embed:set";
export const EMBED_READY = "fms-embed:ready";

const AUTH_PARAM = /^(auth|authorization|token|api[_-]?key|armada[_-]?auth|auth[_-]?header)$/i;

export type EmbedConfig = {
  compact: boolean;
  tenantKey: string;
  appId: string;
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

export const UNLOCKED_FIELDS = {
  group: false,
  user: false,
  from: false,
  to: false,
  tz: false,
} as const;

export const DEFAULT_EMBED_ORIGINS = "https://armada.id,https://*.armada.id";

export function embedOriginAllowlist(): string[] {
  const fromEnv = allowedOrigins(import.meta.env.VITE_EMBED_ORIGINS);
  return fromEnv.length > 0 ? fromEnv : allowedOrigins(DEFAULT_EMBED_ORIGINS);
}

export function allowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function originMatches(origin: string, pattern: string): boolean {
  if (pattern === origin) return true;
  const wild = /^(https?:\/\/)\*\.(.+)$/i.exec(pattern);
  if (!wild) return false;
  try {
    const parsed = new URL(origin);
    if (`${parsed.protocol}//` !== wild[1]) return false;
    const rootHost = wild[2].toLowerCase();
    const host = parsed.hostname.toLowerCase();
    return host === rootHost || host.endsWith(`.${rootHost}`);
  } catch {
    return false;
  }
}

export function originAllowed(eventOrigin: string, allowlist: string[], selfOrigin: string): boolean {
  if (allowlist.length === 0) return eventOrigin === selfOrigin;
  return allowlist.some((pattern) => originMatches(eventOrigin, pattern));
}

function idParam(value: string | null | undefined): string {
  if (!value) return "";
  return /^\d+$/.test(value) ? value : "";
}

function tenantKeyParam(value: string | null | undefined): string {
  if (!value) return "";
  return /^[A-Za-z0-9._-]{8,80}$/.test(value) ? value : "";
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

/**
 * Host context only. Auth query keys are dropped and never returned.
 * Filters stay editable even inside an Armada iframe: the host may pre-fill
 * group/user/dates, but never greys out pickers.
 */
export function parseEmbedSearch(search: string): EmbedConfig {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  for (const key of [...params.keys()]) {
    if (AUTH_PARAM.test(key)) params.delete(key);
  }

  const tenantKey = tenantKeyParam(params.get("k"));
  const appId = idParam(params.get("appId"));
  const groupId = idParam(params.get("groupId"));
  const userId = idParam(params.get("userId"));
  const from = dateParam(params.get("from"));
  const to = dateParam(params.get("to"));

  return {
    compact: compactFlag(params.get("embed")),
    tenantKey,
    appId,
    groupId,
    userId,
    from,
    to,
    tz: tzParam(params.get("tz")),
    period: periodParam(params.get("period")),
    lock: { ...UNLOCKED_FIELDS },
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

  const tenantKey = tenantKeyParam(pick("k"));
  const appId = idParam(pick("appId"));
  const groupId = idParam(pick("groupId"));
  const userId = idParam(pick("userId"));
  const from = dateParam(pick("from"));
  const to = dateParam(pick("to"));
  const tzRaw = pick("tz");

  return {
    compact: msg.embed === undefined ? true : compactFlag(msg.embed as string | boolean | undefined),
    tenantKey,
    appId,
    groupId,
    userId,
    from,
    to,
    tz: tzParam(tzRaw),
    period: periodParam(pick("period")),
    lock: { ...UNLOCKED_FIELDS },
  };
}
