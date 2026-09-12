/**
 * Dispatch Live progress timeline (Layer C) — pure layout helpers.
 */

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
  minute: number;
  pct: number;
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

export function minToHm(minute: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minute)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Minutes of day in Asia/Jakarta for an ISO timestamp. */
export function isoToJakartaMin(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
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
  return Math.max(0, Math.floor(min / 60) * 60);
}

function padCeilHour(min: number): number {
  return Math.min(24 * 60, Math.ceil(min / 60) * 60);
}

/**
 * Axis from observed times, defaulting to 07:00–18:00 and expanding as needed.
 */
export function buildTimelineAxis(
  minutes: number[],
  opts?: { nowMin?: number | null; defaultStart?: number; defaultEnd?: number },
): TimelineAxis {
  const defStart = opts?.defaultStart ?? DEFAULT_TIMELINE_START_MIN;
  const defEnd = opts?.defaultEnd ?? DEFAULT_TIMELINE_END_MIN;
  let startMin = defStart;
  let endMin = defEnd;

  for (const m of minutes) {
    if (!Number.isFinite(m)) continue;
    startMin = Math.min(startMin, m);
    endMin = Math.max(endMin, m);
  }
  if (opts?.nowMin != null && Number.isFinite(opts.nowMin)) {
    startMin = Math.min(startMin, opts.nowMin);
    endMin = Math.max(endMin, opts.nowMin);
  }

  startMin = padFloorHour(startMin - 30);
  endMin = padCeilHour(endMin + 30);
  if (endMin - startMin < 60) endMin = startMin + 60 * 4;

  const ticks: number[] = [];
  for (let t = startMin; t <= endMin; t += 60) ticks.push(t);

  const nowPct =
    opts?.nowMin != null && Number.isFinite(opts.nowMin)
      ? minuteToPct(opts.nowMin, startMin, endMin)
      : null;

  return { startMin, endMin, ticks, nowPct };
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

function initialPlacement(stop: TimelineStopInput): RawPlacement {
  const windowStartMin = hmToMin(stop.windowStart);
  const windowEndMin = hmToMin(stop.windowEnd);
  const actual = isoToJakartaMin(stop.completedAt) ?? isoToJakartaMin(stop.arrivedAt);
  if (actual != null) {
    return {
      stop,
      minute: actual,
      timeSource: "actual",
      windowStartMin,
      windowEndMin,
    };
  }
  const planned = hmToMin(stop.plannedEta);
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
  opts?: { nowMin?: number | null },
): { axis: TimelineAxis; rows: TimelineRow[] } {
  const rawRows = drivers.map((d) => {
    const placements = expandStopsWithAnchors(d).map(initialPlacement);
    return { driver: d, placements };
  });

  const seedMinutes: number[] = [];
  for (const row of rawRows) {
    for (const p of row.placements) {
      if (p.minute != null) seedMinutes.push(p.minute);
      if (p.windowStartMin != null) seedMinutes.push(p.windowStartMin);
      if (p.windowEndMin != null) seedMinutes.push(p.windowEndMin);
    }
    const started = isoToJakartaMin(row.driver.startedAt);
    if (started != null) seedMinutes.push(started);
  }

  const draftAxis = buildTimelineAxis(seedMinutes, { nowMin: opts?.nowMin ?? null });

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
      const timeLabel =
        timeSource === "actual" && p.stop.timeLabel
          ? p.stop.timeLabel
          : timeSource === "planned" && p.stop.plannedEta
            ? p.stop.plannedEta
            : minToHm(minute);
      return {
        stopId: p.stop.stopId,
        jobId: p.stop.jobId || driver.jobId,
        stopNumber: p.stop.stopNumber,
        label,
        status: p.stop.status,
        role,
        minute,
        pct: 0,
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
      if (n.windowStartMin != null) ms.push(n.windowStartMin);
      if (n.windowEndMin != null) ms.push(n.windowEndMin);
      return ms;
    }),
  );
  const axis = buildTimelineAxis(allMinutes, { nowMin: opts?.nowMin ?? null });

  for (const row of rows) {
    for (const n of row.nodes) {
      n.pct = minuteToPct(n.minute, axis.startMin, axis.endMin);
      n.windowStartPct =
        n.windowStartMin != null ? minuteToPct(n.windowStartMin, axis.startMin, axis.endMin) : null;
      n.windowEndPct =
        n.windowEndMin != null ? minuteToPct(n.windowEndMin, axis.startMin, axis.endMin) : null;
    }
  }

  return { axis, rows };
}

export function nowJakartaMin(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function todayJakartaYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
