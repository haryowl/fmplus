/**
 * Single source of truth for the tenant service day (Asia/Jakarta).
 *
 * Before this module, "today" was computed three different ways: host-local in
 * dispatch-api / field-api, Asia/Jakarta in dispatch-live / dispatch-recovery,
 * and browser-local on the client. A host in any zone other than UTC+7
 * disagreed with Live about which calendar day was in progress.
 */

export const SERVICE_TIMEZONE = "Asia/Jakarta";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar day (YYYY-MM-DD) in the service timezone. */
export function todayServiceDate(now = new Date()) {
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
export function nowClockHm(now = new Date()) {
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
export function formatClockAt(iso) {
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
export function serviceDateAt(iso) {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return todayServiceDate(d);
}

/**
 * Calendar YYYY-MM-DD from a PG DATE value.
 *
 * node-pg materializes DATE as a Date at *host-local* midnight, so the local
 * getters are what correctly reverse that construction. Do not reformat this
 * through a timezone: toISOString() (or a UTC+7 conversion) shifts the day.
 */
export function formatServiceDate(rowVal) {
  if (rowVal == null || rowVal === "") return "";
  if (rowVal instanceof Date) {
    const y = rowVal.getFullYear();
    const m = String(rowVal.getMonth() + 1).padStart(2, "0");
    const d = String(rowVal.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(rowVal).trim());
  return m ? m[1] : "";
}

/** Validate and normalize a YYYY-MM-DD string, or null. */
export function parseServiceDate(v) {
  const s = String(v || "").trim().slice(0, 10);
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
export function addDays(ymd, deltaDays) {
  const m = YMD_RE.exec(String(ymd || "").trim());
  if (!m) return "";
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + (Number(deltaDays) || 0));
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Whole days from `fromYmd` to `toYmd` (negative when `toYmd` is earlier). */
export function dayDiff(fromYmd, toYmd) {
  const a = YMD_RE.exec(String(fromYmd || "").trim());
  const b = YMD_RE.exec(String(toYmd || "").trim());
  if (!a || !b) return null;
  const ta = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const tb = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((tb - ta) / 86_400_000);
}

/** "HH:MM" to minutes from midnight, or null. */
export function hmToMin(hm) {
  const m = String(hm || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/** Minutes from midnight to "HH:MM"; values past 24h wrap for display. */
export function minToHm(mins) {
  if (mins == null || !Number.isFinite(mins)) return "";
  const m = Math.max(0, Math.round(mins)) % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Minutes since midnight of `anchorYmd` in the service timezone.
 *
 * Unlike a plain clock read, this keeps the calendar day: work completed at
 * 00:20 the morning after `anchorYmd` returns 1460, not 20, so overnight
 * execution sorts and renders after the rest of its own day.
 */
export function minutesSinceServiceMidnight(iso, anchorYmd) {
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
