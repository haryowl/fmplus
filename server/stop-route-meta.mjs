/**
 * Shared planned ETA chain (same rules as client buildStopRouteMeta / Jobs sequence).
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

/**
 * @param {Array<{ windowStart?: string, serviceMinutes?: number | null }>} stops
 * @param {Array<{ distanceKm?: number, durationSec?: number }>} legs
 * @param {number} [defaultServiceMinutes=8]
 * @param {{ hasRouteStart?: boolean, hasRouteEnd?: boolean }} [opts]
 */
export function buildStopRouteMeta(stops, legs, defaultServiceMinutes = 8, opts = {}) {
  const hasRouteStart = Boolean(opts.hasRouteStart);
  const hasRouteEnd = Boolean(opts.hasRouteEnd);
  const list = Array.isArray(stops) ? stops : [];
  const legList = Array.isArray(legs) ? legs : [];
  const start =
    list.map((s) => parseClockToMinutes(s.windowStart)).find((n) => n != null) ?? 8 * 60;
  let elapsedMin = 0;
  const depotDepart = hasRouteStart ? formatClockMinutes(start) : null;

  const stopMetas = list.map((stop, i) => {
    const inboundIdx = hasRouteStart ? i : i === 0 ? null : i - 1;
    let legDistanceKm = null;
    let legDurationSec = null;
    if (inboundIdx != null) {
      const leg = legList[inboundIdx];
      legDistanceKm = leg?.distanceKm != null ? Number(leg.distanceKm) : null;
      legDurationSec = leg?.durationSec != null ? Number(leg.durationSec) : null;
      elapsedMin += (Number(leg?.durationSec) || 0) / 60;
    }
    const eta = formatClockMinutes(start + elapsedMin);
    const svc =
      stop.serviceMinutes != null && Number.isFinite(Number(stop.serviceMinutes))
        ? Math.max(0, Number(stop.serviceMinutes))
        : Math.max(0, defaultServiceMinutes);
    elapsedMin += svc;
    return {
      legDistanceKm: Number.isFinite(legDistanceKm) ? legDistanceKm : null,
      legDurationSec: Number.isFinite(legDurationSec) ? legDurationSec : null,
      eta,
    };
  });

  let returnLeg = null;
  if (hasRouteEnd && list.length > 0) {
    const returnIdx = hasRouteStart ? list.length : Math.max(0, list.length - 1);
    const leg = legList[returnIdx];
    elapsedMin += (Number(leg?.durationSec) || 0) / 60;
    returnLeg = {
      legDistanceKm:
        leg?.distanceKm != null && Number.isFinite(Number(leg.distanceKm))
          ? Number(leg.distanceKm)
          : null,
      legDurationSec:
        leg?.durationSec != null && Number.isFinite(Number(leg.durationSec))
          ? Number(leg.durationSec)
          : null,
      eta: formatClockMinutes(start + elapsedMin),
    };
  }

  return { depotDepart, stops: stopMetas, returnLeg };
}
