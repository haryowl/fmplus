import { MAX_GAP_MS, MAX_HOURS_PER_DAY } from "./config";

export type IgnitionTrackPoint = {
  utc?: string;
  variables?: Record<string, unknown>;
};

function isIgnitionOn(variables: Record<string, unknown> | undefined): boolean {
  return variables?.ignition === true;
}

function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addCapped(daily: Record<string, number>, dateKey: string, seconds: number, maxHoursPerDay: number): number {
  if (!daily[dateKey]) daily[dateKey] = 0;
  const remaining = maxHoursPerDay * 3600 - daily[dateKey];
  const add = Math.min(seconds, Math.max(0, remaining));
  daily[dateKey] += add;
  return add;
}

/**
 * Sum ignition-on track time (moving + idle with ign on), matching dashboard
 * activeHours + idleHours gap rules.
 */
export function sumIgnitionOnHours(
  points: IgnitionTrackPoint[],
  opts?: {
    maxGapMs?: number;
    maxHoursPerDay?: number;
    /** Inclusive lower bound (ms). Gaps that end before this are ignored. */
    sinceMs?: number | null;
    /** Exclusive upper bound (ms). */
    untilMs?: number | null;
  },
): number {
  const maxGapMs = opts?.maxGapMs ?? MAX_GAP_MS;
  const maxHoursPerDay = opts?.maxHoursPerDay ?? MAX_HOURS_PER_DAY;
  const sinceMs = opts?.sinceMs ?? null;
  const untilMs = opts?.untilMs ?? null;

  const samples: { ms: number; ignition: boolean }[] = [];
  for (const point of points) {
    if (!point.utc) continue;
    const ms = Date.parse(point.utc);
    if (!Number.isFinite(ms)) continue;
    if (untilMs != null && ms >= untilMs) continue;
    samples.push({ ms, ignition: isIgnitionOn(point.variables) });
  }
  samples.sort((a, b) => a.ms - b.ms);

  let seconds = 0;
  const daily: Record<string, number> = {};
  let prev: { ms: number; ignition: boolean } | null = null;

  for (const sample of samples) {
    if (prev) {
      const dt = (sample.ms - prev.ms) / 1000;
      if (dt > 0 && dt * 1000 <= maxGapMs && prev.ignition) {
        // Attribute the gap to the start sample; clip if window starts mid-gap.
        let gapStart = prev.ms;
        let gapEnd = sample.ms;
        if (sinceMs != null) {
          if (gapEnd <= sinceMs) {
            prev = sample;
            continue;
          }
          if (gapStart < sinceMs) gapStart = sinceMs;
        }
        const clipped = (gapEnd - gapStart) / 1000;
        if (clipped > 0) {
          seconds += addCapped(daily, utcDateKey(gapStart), clipped, maxHoursPerDay);
        }
      }
    }
    prev = sample;
  }

  return seconds / 3600;
}
