/**
 * Client mirror of server/service-day.mjs — the tenant service day is
 * Asia/Jakarta, not the browser's zone, so a manager travelling or a laptop
 * left on another timezone still sees the same calendar day as Dispatch Live.
 */

export const SERVICE_TIMEZONE = "Asia/Jakarta";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar day (YYYY-MM-DD) in the service timezone. */
export function todayServiceDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SERVICE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

/** Wall clock HH:MM in the service timezone. */
export function nowClockHm(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SERVICE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

/** Wall clock HH:MM in the service timezone for an ISO timestamp. */
export function formatClockAt(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SERVICE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Calendar day (YYYY-MM-DD) in the service timezone for an ISO timestamp. */
export function serviceDateAt(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return todayServiceDate(d);
}

/** Validate and normalize a YYYY-MM-DD string, or null. */
export function parseServiceDate(v: unknown): string | null {
  const s = String(v ?? "").trim().slice(0, 10);
  const m = YMD_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return s;
}

/** Shift a YYYY-MM-DD by whole days. Timezone-free calendar math. */
export function shiftServiceDate(ymd: string, deltaDays: number): string {
  const m = YMD_RE.exec(String(ymd || "").trim());
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + (Number(deltaDays) || 0));
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Whole days from `fromYmd` to `toYmd` (negative when `toYmd` is earlier). */
export function dayDiff(fromYmd: string, toYmd: string): number | null {
  const a = YMD_RE.exec(String(fromYmd || "").trim());
  const b = YMD_RE.exec(String(toYmd || "").trim());
  if (!a || !b) return null;
  const ta = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const tb = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((tb - ta) / 86_400_000);
}

/** Human label for a calendar date, anchored to the date itself. */
export function formatServiceDateLabel(ymd: string): string {
  const m = YMD_RE.exec(String(ymd || "").trim());
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "HH:MM" to minutes from midnight, or null. */
export function hmToMin(hm: string | null | undefined): number | null {
  const m = String(hm || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/**
 * Minutes since midnight of `anchorYmd` in the service timezone.
 *
 * Keeps the calendar day, so a stop completed at 00:20 the morning after
 * `anchorYmd` returns 1460 rather than 20 and renders after the rest of its day.
 */
export function minutesSinceServiceMidnight(
  iso: string | Date | null | undefined,
  anchorYmd?: string | null,
): number | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const clock = hmToMin(formatClockAt(d));
  if (clock == null) return null;
  const anchor = parseServiceDate(anchorYmd);
  if (!anchor) return clock;
  const dayOffset = dayDiff(anchor, serviceDateAt(d));
  if (dayOffset == null) return clock;
  return dayOffset * 24 * 60 + clock;
}
