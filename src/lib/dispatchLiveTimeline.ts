/**
 * Dispatch Live progress timeline (Layer C) — pure layout helpers.
 *
 * Minutes on this timeline are measured from midnight of the anchor service day,
 * not from midnight of whatever day a timestamp happens to fall in. That lets a
 * stop finished at 00:20 the next morning plot to the right of its own day
 * (minute 1460) and read as late rather than as 23 hours early.
 */
import { dayDiff, minutesSinceServiceMidnight, parseServiceDate, shiftServiceDate, todayServiceDate } from "./serviceDay";

export type TimelineStopInput = {
  stopId: string;
  jobId: string;
  stopNumber: number;
  name: string;
  externalRef?: string;
  status: string;
  windowStart?: string;
  windowEnd?: string;
  arrivedAt?: string | null;
  completedAt?: string | null;
  timeLabel?: string;
  /** Planned road ETA HH:MM (Jobs chain); used until actual arrive/complete. */
  plannedEta?: string | null;
  /**
   * Calendar day this stop belongs to. On a multi-day tour it positions the stop's
   * clock times relative to the anchor day; omit it for single-day work.
   */
  serviceDate?: string;
  role?: "stop" | "depot" | "return";
};

export type TimelineDriverInput = {
  jobId: string;
  driverName: string;
  driverInitials: string;
  vehicleLabel: string;
  pctComplete: number;
  jobStatus: string;
  startedAt?: string | null;
  completedAt?: string | null;
  routeAnchorMode?: string | null;
  routeStart?: { label?: string; lat?: number | null; lon?: number | null } | null;
  routeEnd?: { label?: string; lat?: number | null; lon?: number | null } | null;
  plannedDepotDepart?: string | null;
  plannedReturnEta?: string | null;
  stops: TimelineStopInput[];
};

export type TimelineNode = {
  stopId: string;
  jobId: string;
  stopNumber: number;
  label: string;
  status: string;
  role: "stop" | "depot" | "return";
  /** Primary position (actual if present, else planned/window/sequence). */
  minute: number;
  pct: number;
  /** Planned road ETA minute when known (kept even after completion). */
  plannedMinute: number | null;
  plannedPct: number | null;
  plannedTimeLabel: string | null;
  /** Actual arrive/complete minute when known. */
  actualMinute: number | null;
  actualPct: number | null;
  actualTimeLabel: string | null;
  /** actual − planned in minutes (null if either missing). */
  deltaMin: number | null;
  windowStartMin: number | null;
  windowEndMin: number | null;
  windowStartPct: number | null;
  windowEndPct: number | null;
  timeSource: "actual" | "planned" | "window" | "sequence";
  timeLabel: string;
};

export type TimelineRow = {
  jobId: string;
  driverName: string;
  driverInitials: string;
  vehicleLabel: string;
  pctComplete: number;
  jobStatus: string;
  nodes: TimelineNode[];
};

export type TimelineAxis = {
  startMin: number;
  endMin: number;
  ticks: number[];
  /** Display labels parallel to `ticks` (may include dates when multi-day). */
  tickLabels: string[];
  nowPct: number | null;
};

export const DEFAULT_TIMELINE_START_MIN = 7 * 60; // 07:00
export const DEFAULT_TIMELINE_END_MIN = 18 * 60; // 18:00

export function hmToMin(hm: string | null | undefined): number | null {
  const m = String(hm || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Wall clock for a timeline minute. Minutes past 1440 belong to the following
 * calendar day, so they wrap for display: 1460 reads "00:20".
 */
export function minToHm(minute: number): string {
  const wrapped = ((Math.round(minute) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Minutes in a day. Timeline minutes may exceed this for overnight work. */
export const DAY_MIN = 24 * 60;

/** Short calendar label for an anchored timeline minute (e.g. "22 Sep"). */
export function shortDateForTimelineMin(
  minute: number,
  anchorYmd: string | null | undefined,
): string {
  const anchor = parseServiceDate(anchorYmd);
  if (!anchor) {
    const dayOff = Math.floor(Math.round(minute) / DAY_MIN);
    if (dayOff === 0) return "Day";
    return dayOff > 0 ? `+${dayOff}d` : `${dayOff}d`;
  }
  const dayOff = Math.floor(Math.round(minute) / DAY_MIN);
  const ymd = shiftServiceDate(anchor, dayOff);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });
}

/**
 * Axis tick label. Same-day windows stay as HH:MM; multi-day / overnight
 * windows include the calendar date so the scale stays readable.
 */
export function formatTimelineTick(
  minute: number,
  opts?: { anchorYmd?: string | null; multiDay?: boolean },
): string {
  const hm = minToHm(minute);
  const dayOff = Math.floor(Math.round(minute) / DAY_MIN);
  const clockMin = ((Math.round(minute) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const multiDay = Boolean(opts?.multiDay) || dayOff !== 0;
  if (!multiDay) return hm;
  const date = shortDateForTimelineMin(minute, opts?.anchorYmd);
  // Midnight ticks: date alone is enough and avoids clutter.
  if (clockMin === 0) return date;
  return `${date} ${hm}`;
}

export function isoToJakartaMin(
  iso: string | null | undefined,
  anchorYmd?: string | null,
): number | null {
  return minutesSinceServiceMidnight(iso, anchorYmd ?? null);
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function minuteToPct(minute: number, startMin: number, endMin: number): number {
  const span = Math.max(1, endMin - startMin);
  return clampPct(((minute - startMin) / span) * 100);
}

function padFloorHour(min: number): number {
  return Math.floor(min / 60) * 60;
}

/**
 * No 24-hour cap: a multi-day tour, or a day that ran past midnight, legitimately
 * needs minutes beyond 1440.
 */
function padCeilHour(min: number): number {
  return Math.ceil(min / 60) * 60;
}

/** Tick step so labels stay readable as the window grows. */
export function timelineTickStep(spanMin: number): number {
  if (spanMin <= 12 * 60) return 60;
  if (spanMin <= 24 * 60) return 120;
  if (spanMin <= 36 * 60) return 180;
  if (spanMin <= 3 * DAY_MIN) return 360;
  return DAY_MIN;
}

/**
 * Drop extreme outliers that would force an unreadable multi-week axis.
 * Prefer times near the service day (with overnight spill); otherwise a ±1 day
 * band around the median.
 */
export function coreMinutesForAxis(minutes: number[]): number[] {
  const vals = minutes.filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
  if (vals.length <= 1) return vals;
  const span = vals[vals.length - 1]! - vals[0]!;
  if (span <= 2 * DAY_MIN) return vals;

  const nearServiceDay = vals.filter((m) => m >= -6 * 60 && m <= 2 * DAY_MIN);
  if (nearServiceDay.length >= Math.max(2, Math.ceil(vals.length * 0.5))) {
    return nearServiceDay;
  }

  const mid = vals[Math.floor(vals.length / 2)]!;
  const windowed = vals.filter((m) => m >= mid - DAY_MIN && m <= mid + DAY_MIN);
  return windowed.length >= 2 ? windowed : vals.slice(-8);
}

/**
 * Axis from observed times, defaulting to 07:00–18:00 and expanding as needed.
 * Soft-clips wild outliers and spaces ticks by span; multi-day labels use dates.
 */
export function buildTimelineAxis(
  minutes: number[],
  opts?: {
    nowMin?: number | null;
    defaultStart?: number;
    defaultEnd?: number;
    anchorYmd?: string | null;
  },
): TimelineAxis {
  const defStart = opts?.defaultStart ?? DEFAULT_TIMELINE_START_MIN;
  const defEnd = opts?.defaultEnd ?? DEFAULT_TIMELINE_END_MIN;
  const core = coreMinutesForAxis(minutes);
  let startMin = defStart;
  let endMin = defEnd;

  for (const m of core) {
    startMin = Math.min(startMin, m);
    endMin = Math.max(endMin, m);
  }
  if (opts?.nowMin != null && Number.isFinite(opts.nowMin)) {
    // Keep "now" in view only when it sits near the working window.
    const near =
      opts.nowMin >= startMin - DAY_MIN && opts.nowMin <= endMin + DAY_MIN;
    if (near) {
      startMin = Math.min(startMin, opts.nowMin);
      endMin = Math.max(endMin, opts.nowMin);
    }
  }

  startMin = padFloorHour(startMin - 30);
  endMin = padCeilHour(endMin + 30);
  if (endMin - startMin < 60) endMin = startMin + 60 * 4;

  const span = endMin - startMin;
  const step = timelineTickStep(span);
  const multiDay = span > DAY_MIN || startMin < 0 || endMin > DAY_MIN;

  // Align first tick to the step grid.
  let tickStart = Math.floor(startMin / step) * step;
  if (tickStart < startMin - step / 2) tickStart += step;
  const ticks: number[] = [];
  for (let t = tickStart; t <= endMin + 0.5; t += step) {
    ticks.push(t);
  }
  if (!ticks.length || ticks[0]! > startMin) ticks.unshift(startMin);
  if (ticks[ticks.length - 1]! < endMin) ticks.push(endMin);

  // Deduplicate after forcing endpoints.
  const uniq: number[] = [];
  for (const t of ticks) {
    if (!uniq.length || Math.abs(uniq[uniq.length - 1]! - t) >= step * 0.45) {
      uniq.push(t);
    } else {
      uniq[uniq.length - 1] = t;
    }
  }

  const tickLabels = uniq.map((t) =>
    formatTimelineTick(t, { anchorYmd: opts?.anchorYmd, multiDay }),
  );

  const nowPct =
    opts?.nowMin != null && Number.isFinite(opts.nowMin)
      ? minuteToPct(opts.nowMin, startMin, endMin)
      : null;

  return { startMin, endMin, ticks: uniq, tickLabels, nowPct };
}

type RawPlacement = {
  stop: TimelineStopInput;
  minute: number | null;
  timeSource: TimelineNode["timeSource"] | null;
  windowStartMin: number | null;
  windowEndMin: number | null;
};

function windowMid(start: number | null, end: number | null): number | null {
  if (start != null && end != null) return Math.round((start + end) / 2);
  return start ?? end;
}

/** Whole days between the anchor day and the stop's own day. */
function dayOffsetOf(stop: TimelineStopInput, anchorYmd?: string | null): number {
  if (!anchorYmd || !stop.serviceDate) return 0;
  return dayDiff(anchorYmd, stop.serviceDate) ?? 0;
}

/** A clock reading on the stop's own day, expressed in anchored timeline minutes. */
function onDay(
  clockMin: number | null,
  stop: TimelineStopInput,
  anchorYmd?: string | null,
): number | null {
  if (clockMin == null) return null;
  return clockMin + dayOffsetOf(stop, anchorYmd) * DAY_MIN;
}

function initialPlacement(stop: TimelineStopInput, anchorYmd?: string | null): RawPlacement {
  const windowStartMin = onDay(hmToMin(stop.windowStart), stop, anchorYmd);
  const windowEndMin = onDay(hmToMin(stop.windowEnd), stop, anchorYmd);
  const actual =
    isoToJakartaMin(stop.completedAt, anchorYmd) ?? isoToJakartaMin(stop.arrivedAt, anchorYmd);
  if (actual != null) {
    return {
      stop,
      minute: actual,
      timeSource: "actual",
      windowStartMin,
      windowEndMin,
    };
  }
  const planned = onDay(hmToMin(stop.plannedEta), stop, anchorYmd);
  if (planned != null) {
    return {
      stop,
      minute: planned,
      timeSource: "planned",
      windowStartMin,
      windowEndMin,
    };
  }
  const win = windowMid(windowStartMin, windowEndMin);
  if (win != null) {
    return {
      stop,
      minute: win,
      timeSource: "window",
      windowStartMin,
      windowEndMin,
    };
  }
  return {
    stop,
    minute: null,
    timeSource: null,
    windowStartMin,
    windowEndMin,
  };
}

/** Fill null minutes by linear interpolation between known neighbors (sequence fallback). */
export function fillSequenceMinutes(
  placements: { minute: number | null }[],
  fallbackStart: number,
  fallbackEnd: number,
): number[] {
  const n = placements.length;
  const out = placements.map((p) => p.minute);
  if (!n) return out as number[];

  const known = out
    .map((m, i) => (m != null ? i : -1))
    .filter((i) => i >= 0) as number[];

  if (!known.length) {
    if (n === 1) return [Math.round((fallbackStart + fallbackEnd) / 2)];
    for (let i = 0; i < n; i++) {
      out[i] = Math.round(fallbackStart + ((fallbackEnd - fallbackStart) * i) / (n - 1));
    }
    return out as number[];
  }

  // Leading unknowns → step back from first known
  const first = known[0]!;
  for (let i = first - 1; i >= 0; i--) {
    const step = 20;
    out[i] = (out[i + 1] as number) - step;
  }

  // Trailing unknowns → step forward from last known
  const last = known[known.length - 1]!;
  for (let i = last + 1; i < n; i++) {
    out[i] = (out[i - 1] as number) + 20;
  }

  // Gaps between known → interpolate
  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k]!;
    const b = known[k + 1]!;
    if (b - a <= 1) continue;
    const ma = out[a] as number;
    const mb = out[b] as number;
    for (let i = a + 1; i < b; i++) {
      const t = (i - a) / (b - a);
      out[i] = Math.round(ma + (mb - ma) * t);
    }
  }

  return out as number[];
}

function expandStopsWithAnchors(driver: TimelineDriverInput): TimelineStopInput[] {
  const mode = String(driver.routeAnchorMode || "").toLowerCase();
  const useAnchors = mode === "map" || mode === "sequence";
  const customer = [...driver.stops]
    .map((s) => ({ ...s, role: s.role || ("stop" as const) }))
    .sort((a, b) => a.stopNumber - b.stopNumber);
  const out: TimelineStopInput[] = [];

  if (useAnchors && driver.routeStart) {
    const departed = Boolean(driver.startedAt);
    out.push({
      stopId: `${driver.jobId}::depot-start`,
      jobId: driver.jobId,
      stopNumber: 0,
      name: driver.routeStart.label || "Depot / start",
      status: departed || driver.jobStatus === "done" ? "delivered" : "pending",
      arrivedAt: driver.startedAt || null,
      completedAt: driver.startedAt || null,
      plannedEta: driver.plannedDepotDepart || null,
      timeLabel: undefined,
      role: "depot",
    });
  }

  out.push(...customer);

  if (useAnchors && driver.routeEnd) {
    out.push({
      stopId: `${driver.jobId}::depot-return`,
      jobId: driver.jobId,
      stopNumber: (customer[customer.length - 1]?.stopNumber || customer.length) + 1,
      name: driver.routeEnd.label || "Return",
      status: driver.jobStatus === "done" ? "delivered" : "pending",
      arrivedAt: driver.completedAt || null,
      completedAt: driver.completedAt || null,
      plannedEta: driver.plannedReturnEta || null,
      timeLabel: undefined,
      role: "return",
    });
  }

  return out;
}

export function buildTimelineRows(
  drivers: TimelineDriverInput[],
  opts?: { nowMin?: number | null; anchorYmd?: string | null },
): { axis: TimelineAxis; rows: TimelineRow[] } {
  const anchorYmd = opts?.anchorYmd ?? null;
  const rawRows = drivers.map((d) => {
    const placements = expandStopsWithAnchors(d).map((s) => initialPlacement(s, anchorYmd));
    return { driver: d, placements };
  });

  const seedMinutes: number[] = [];
  for (const row of rawRows) {
    for (const p of row.placements) {
      if (p.minute != null) seedMinutes.push(p.minute);
      const planned = onDay(hmToMin(p.stop.plannedEta), p.stop, anchorYmd);
      if (planned != null) seedMinutes.push(planned);
      const actual =
        isoToJakartaMin(p.stop.completedAt, anchorYmd) ??
        isoToJakartaMin(p.stop.arrivedAt, anchorYmd);
      if (actual != null) seedMinutes.push(actual);
      if (p.windowStartMin != null) seedMinutes.push(p.windowStartMin);
      if (p.windowEndMin != null) seedMinutes.push(p.windowEndMin);
    }
    const started = isoToJakartaMin(row.driver.startedAt, anchorYmd);
    if (started != null) seedMinutes.push(started);
  }

  const draftAxis = buildTimelineAxis(seedMinutes, {
    nowMin: opts?.nowMin ?? null,
    anchorYmd,
  });

  const rows: TimelineRow[] = rawRows.map(({ driver, placements }) => {
    const minutes = fillSequenceMinutes(
      placements,
      draftAxis.startMin + 30,
      draftAxis.endMin - 30,
    );
    const nodes: TimelineNode[] = placements.map((p, i) => {
      const minute = minutes[i]!;
      const timeSource: TimelineNode["timeSource"] =
        p.timeSource ?? "sequence";
      const role = p.stop.role || "stop";
      const label =
        role === "depot" || role === "return"
          ? p.stop.name
          : p.stop.externalRef || p.stop.name || `Stop ${p.stop.stopNumber}`;
      const plannedMinute = onDay(hmToMin(p.stop.plannedEta), p.stop, anchorYmd);
      const actualMinute =
        isoToJakartaMin(p.stop.completedAt, anchorYmd) ??
        isoToJakartaMin(p.stop.arrivedAt, anchorYmd);
      const plannedTimeLabel = plannedMinute != null ? p.stop.plannedEta || minToHm(plannedMinute) : null;
      const actualTimeLabel =
        actualMinute != null
          ? p.stop.timeLabel || minToHm(actualMinute)
          : null;
      const timeLabel =
        timeSource === "actual" && actualTimeLabel
          ? actualTimeLabel
          : timeSource === "planned" && plannedTimeLabel
            ? plannedTimeLabel
            : minToHm(minute);
      const deltaMin =
        actualMinute != null && plannedMinute != null ? actualMinute - plannedMinute : null;
      return {
        stopId: p.stop.stopId,
        jobId: p.stop.jobId || driver.jobId,
        stopNumber: p.stop.stopNumber,
        label,
        status: p.stop.status,
        role,
        minute,
        pct: 0,
        plannedMinute,
        plannedPct: null,
        plannedTimeLabel,
        actualMinute,
        actualPct: null,
        actualTimeLabel,
        deltaMin,
        windowStartMin: p.windowStartMin,
        windowEndMin: p.windowEndMin,
        windowStartPct: null,
        windowEndPct: null,
        timeSource,
        timeLabel,
      };
    });
    return {
      jobId: driver.jobId,
      driverName: driver.driverName,
      driverInitials: driver.driverInitials,
      vehicleLabel: driver.vehicleLabel,
      pctComplete: driver.pctComplete,
      jobStatus: driver.jobStatus,
      nodes,
    };
  });

  const allMinutes = rows.flatMap((r) =>
    r.nodes.flatMap((n) => {
      const ms = [n.minute];
      if (n.plannedMinute != null) ms.push(n.plannedMinute);
      if (n.actualMinute != null) ms.push(n.actualMinute);
      if (n.windowStartMin != null) ms.push(n.windowStartMin);
      if (n.windowEndMin != null) ms.push(n.windowEndMin);
      return ms;
    }),
  );
  const axis = buildTimelineAxis(allMinutes, {
    nowMin: opts?.nowMin ?? null,
    anchorYmd,
  });

  for (const row of rows) {
    for (const n of row.nodes) {
      n.pct = minuteToPct(n.minute, axis.startMin, axis.endMin);
      n.plannedPct =
        n.plannedMinute != null ? minuteToPct(n.plannedMinute, axis.startMin, axis.endMin) : null;
      n.actualPct =
        n.actualMinute != null ? minuteToPct(n.actualMinute, axis.startMin, axis.endMin) : null;
      n.windowStartPct =
        n.windowStartMin != null ? minuteToPct(n.windowStartMin, axis.startMin, axis.endMin) : null;
      n.windowEndPct =
        n.windowEndMin != null ? minuteToPct(n.windowEndMin, axis.startMin, axis.endMin) : null;
    }
  }

  return { axis, rows };
}

/**
 * The now-marker, on the same anchored scale as the nodes. Viewing yesterday's
 * board at 09:00 today puts the marker at 1980, correctly off the right edge
 * rather than in the middle of yesterday's morning.
 */
export function nowJakartaMin(anchorYmd?: string | null): number {
  return minutesSinceServiceMidnight(new Date(), anchorYmd ?? null) ?? 0;
}

export function todayJakartaYmd(): string {
  return todayServiceDate();
}
