/**
 * Ignition-on hours from track points (moving + idle with ign on).
 * Mirrors src/lib/ignitionHours.ts / dashboard active+idle gap rules.
 */
const MAX_GAP_MS = 5 * 60 * 1000;
const MAX_HOURS_PER_DAY = 24;

function isIgnitionOn(variables) {
  return variables && variables.ignition === true;
}

function utcDateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addCapped(daily, dateKey, seconds, maxHoursPerDay) {
  if (!daily[dateKey]) daily[dateKey] = 0;
  const remaining = maxHoursPerDay * 3600 - daily[dateKey];
  const add = Math.min(seconds, Math.max(0, remaining));
  daily[dateKey] += add;
  return add;
}

/**
 * @param {Array<{ utc?: string, variables?: Record<string, unknown> }>} points
 * @param {{ maxGapMs?: number, maxHoursPerDay?: number, sinceMs?: number|null, untilMs?: number|null }} [opts]
 */
export function sumIgnitionOnHours(points, opts = {}) {
  const maxGapMs = opts.maxGapMs ?? MAX_GAP_MS;
  const maxHoursPerDay = opts.maxHoursPerDay ?? MAX_HOURS_PER_DAY;
  const sinceMs = opts.sinceMs ?? null;
  const untilMs = opts.untilMs ?? null;

  const samples = [];
  for (const point of points || []) {
    if (!point?.utc) continue;
    const ms = Date.parse(point.utc);
    if (!Number.isFinite(ms)) continue;
    if (untilMs != null && ms >= untilMs) continue;
    samples.push({ ms, ignition: isIgnitionOn(point.variables) });
  }
  samples.sort((a, b) => a.ms - b.ms);

  let seconds = 0;
  const daily = {};
  let prev = null;

  for (const sample of samples) {
    if (prev) {
      const dt = (sample.ms - prev.ms) / 1000;
      if (dt > 0 && dt * 1000 <= maxGapMs && prev.ignition) {
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

export function eachDateYmd(fromYmd, toYmd) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) return out;
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    const d = new Date(`${cur}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return out;
}
