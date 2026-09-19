/** Timed GPS sample for clipping day tracks to a job window. */
export type TimedMapPoint = {
  lat: number;
  lon: number;
  recordedAt: string;
};

/**
 * Keep points between job start and end (or now if still open).
 * If start is missing, keep from the beginning of the day trail.
 * If the window would empty a known trail, fall back to the unclipped line
 * so the map still shows something useful.
 */
export function clipTimedTrackToWindow(
  points: TimedMapPoint[],
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  nowMs = Date.now(),
): [number, number][] {
  if (!points.length) return [];
  const startMs = startIso ? Date.parse(startIso) : NaN;
  const endMs = endIso ? Date.parse(endIso) : NaN;
  const from = Number.isFinite(startMs) ? startMs : -Infinity;
  const to = Number.isFinite(endMs) ? endMs : nowMs;

  const out: [number, number][] = [];
  for (const p of points) {
    const t = Date.parse(p.recordedAt);
    if (!Number.isFinite(t)) continue;
    if (t < from || t > to) continue;
    out.push([p.lat, p.lon]);
  }

  if (out.length >= 1) return out;

  // No start/end known — show the full day trail.
  if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) {
    return points.map((p) => [p.lat, p.lon]);
  }
  return out;
}

export function downsampleTimedTrack(
  points: TimedMapPoint[],
  maxPoints = 400,
): TimedMapPoint[] {
  if (points.length <= maxPoints) return points;
  if (maxPoints < 2) return points.slice(0, 1);
  const step = (points.length - 1) / (maxPoints - 1);
  const out: TimedMapPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const p = points[Math.round(i * step)];
    if (p) out.push(p);
  }
  return out;
}
