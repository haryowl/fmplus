/**
 * Shared planned ETA chain (same rules as client buildStopRouteMeta / Jobs sequence).
 *
 * On a multi-day tour the chain restarts on each `dayIndex`: an overnight rest is
 * not travel time, so day 2 begins from its own window rather than inheriting
 * everything day 1 accumulated.
 */

export function parseClockToMinutes(value) {
  const m = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatClockMinutes(totalMinutes) {
  const day = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(day / 60)).padStart(2, "0");
  const mm = String(day % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

const DEFAULT_DAY_START_MIN = 8 * 60;

function dayIndexOf(stop) {
  const n = Number(stop?.dayIndex ?? stop?.day_index);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

/**
 * First clock a day's work is anchored to: the earliest declared window start on
 * that day, falling back to 08:00.
 */
function dayStartMinutes(list) {
  /** @type {Map<number, number>} */
  const byDay = new Map();
  for (const stop of list) {
    const day = dayIndexOf(stop);
    const win = parseClockToMinutes(stop.windowStart);
    if (win == null) continue;
    const current = byDay.get(day);
    if (current == null || win < current) byDay.set(day, win);
  }
  return byDay;
}

/**
 * @param {Array<{ windowStart?: string, serviceMinutes?: number | null, dayIndex?: number }>} stops
 * @param {Array<{ distanceKm?: number, durationSec?: number }>} legs
 * @param {number} [defaultServiceMinutes=8]
 * @param {{ hasRouteStart?: boolean, hasRouteEnd?: boolean, continuousAcrossDays?: boolean }} [opts]
 */
export function buildStopRouteMeta(stops, legs, defaultServiceMinutes = 8, opts = {}) {
  const hasRouteStart = Boolean(opts.hasRouteStart);
  const hasRouteEnd = Boolean(opts.hasRouteEnd);
  const continuousAcrossDays = Boolean(opts.continuousAcrossDays);
  const list = Array.isArray(stops) ? stops : [];
  const legList = Array.isArray(legs) ? legs : [];
  const startsByDay = dayStartMinutes(list);
  const firstDay = list.length ? dayIndexOf(list[0]) : 0;
  const fallbackStart =
    list.map((s) => parseClockToMinutes(s.windowStart)).find((n) => n != null) ??
    DEFAULT_DAY_START_MIN;

  let currentDay = firstDay;
  let start = startsByDay.get(firstDay) ?? fallbackStart;
  const tourStart = start;
  let elapsedMin = 0;
  const depotDepart = hasRouteStart ? formatClockMinutes(start) : null;

  const stopMetas = list.map((stop, i) => {
    const day = dayIndexOf(stop);
    const newDay = i > 0 && day !== currentDay;
    if (newDay) {
      currentDay = day;
      if (!continuousAcrossDays) {
        start = startsByDay.get(day) ?? DEFAULT_DAY_START_MIN;
        elapsedMin = 0;
      }
    }

    const inboundIdx = hasRouteStart ? i : i === 0 ? null : i - 1;
    let legDistanceKm = null;
    let legDurationSec = null;
    if (inboundIdx != null && (continuousAcrossDays || !newDay)) {
      const leg = legList[inboundIdx];
      legDistanceKm = leg?.distanceKm != null ? Number(leg.distanceKm) : null;
      legDurationSec = leg?.durationSec != null ? Number(leg.durationSec) : null;
      elapsedMin += (Number(leg?.durationSec) || 0) / 60;
    }
    const anchor = continuousAcrossDays ? tourStart : start;
    const absArrival = anchor + elapsedMin;
    const eta = formatClockMinutes(absArrival);
    const dayOffset = Math.max(
      0,
      Math.floor(absArrival / (24 * 60)) - Math.floor(anchor / (24 * 60)),
    );
    const svc =
      stop.serviceMinutes != null && Number.isFinite(Number(stop.serviceMinutes))
        ? Math.max(0, Number(stop.serviceMinutes))
        : Math.max(0, defaultServiceMinutes);
    elapsedMin += svc;
    return {
      legDistanceKm: Number.isFinite(legDistanceKm) ? legDistanceKm : null,
      legDurationSec: Number.isFinite(legDurationSec) ? legDurationSec : null,
      eta,
      dayIndex: day,
      dayOffset,
    };
  });

  let returnLeg = null;
  if (hasRouteEnd && list.length > 0) {
    const returnIdx = hasRouteStart ? list.length : Math.max(0, list.length - 1);
    const leg = legList[returnIdx];
    elapsedMin += (Number(leg?.durationSec) || 0) / 60;
    const anchor = continuousAcrossDays ? tourStart : start;
    const absArrival = anchor + elapsedMin;
    returnLeg = {
      legDistanceKm:
        leg?.distanceKm != null && Number.isFinite(Number(leg.distanceKm))
          ? Number(leg.distanceKm)
          : null,
      legDurationSec:
        leg?.durationSec != null && Number.isFinite(Number(leg.durationSec))
          ? Number(leg.durationSec)
          : null,
      eta: formatClockMinutes(absArrival),
      dayIndex: currentDay,
      dayOffset: Math.max(
        0,
        Math.floor(absArrival / (24 * 60)) - Math.floor(anchor / (24 * 60)),
      ),
    };
  }

  return { depotDepart, stops: stopMetas, returnLeg };
}
