/** Offset strings like +08:00 or -05:00 → minutes east of UTC. */
export function offsetToMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Inclusive start of a calendar day in the given offset, as UTC ms. */
export function zonedStartMs(dateYmd: string, offset: string): number {
  return Date.parse(`${dateYmd}T00:00:00${offset}`);
}

/** Inclusive end of a calendar day in the given offset, as UTC ms. */
export function zonedEndMs(dateYmd: string, offset: string): number {
  return Date.parse(`${dateYmd}T23:59:59.999${offset}`);
}

/**
 * Calendar date (YYYY-MM-DD) of an instant in the selected offset.
 * Shift first, then slice ISO — do not also apply the browser timezone.
 */
export function dateKeyInOffset(ms: number, offset: string): string {
  const shifted = new Date(ms + offsetToMinutes(offset) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function todayKeyInOffset(offset: string): string {
  return dateKeyInOffset(Date.now(), offset);
}

export function addDays(dateYmd: string, days: number): string {
  const utc = Date.parse(`${dateYmd}T12:00:00Z`);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * V17 loads trips with three parallel UpdatedSince calls at +0 / +14 / +28 days.
 * Armada does not return an unbounded history from one timestamp — each call
 * covers a bounded window. Extra 14-day steps are added when `dateTo` is later.
 */
export function updatedSinceWindows(dateFrom: string, dateTo: string): string[] {
  const coverThrough = dateTo > addDays(dateFrom, 28) ? dateTo : addDays(dateFrom, 28);
  const windows: string[] = [];
  let cursor = dateFrom;
  while (cursor <= coverThrough) {
    windows.push(cursor);
    cursor = addDays(cursor, 14);
  }
  return windows;
}

/** ISO-8601 week number from a YYYY-MM-DD calendar date. */
export function isoWeek(dateYmd: string): { year: number; week: number } {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export function periodKey(dateYmd: string, period: "daily" | "weekly" | "monthly"): string {
  if (period === "daily") return dateYmd;
  if (period === "weekly") {
    const { year, week } = isoWeek(dateYmd);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  return dateYmd.slice(0, 7);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodLabel(key: string, period: "daily" | "weekly" | "monthly"): string {
  if (period === "daily") {
    const [y, m, d] = key.split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  if (period === "weekly") {
    const [year, week] = key.split("-W");
    return `Week ${Number(week)} · ${year}`;
  }
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatUpdatedSince(dateYmd: string, offset: string): string {
  return `${dateYmd}T00:00:00${offset}`;
}
