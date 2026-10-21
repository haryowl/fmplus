const EARTH_RADIUS_KM = 6371;
const MIN_GPS_JUMP_KM = 1.5;
const MAX_GPS_IMPLIED_SPEED_KMH = 180;
const NULL_ISLAND_DEG = 0.01;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isNullIsland(lat, lon) {
  return Math.abs(lat) < NULL_ISLAND_DEG && Math.abs(lon) < NULL_ISLAND_DEG;
}

export function isImpossibleGpsStep(prev, next) {
  const d = haversineKm(prev.lat, prev.lon, next.lat, next.lon);
  if (!Number.isFinite(d) || d < MIN_GPS_JUMP_KM) return false;
  const dtMs = next.ms - prev.ms;
  if (dtMs <= 0) return true;
  const kmh = d / (dtMs / 3_600_000);
  return kmh > MAX_GPS_IMPLIED_SPEED_KMH;
}

/** Jump-filtered haversine between consecutive valid GNSS fixes, or 0. */
export function gpsStepKm(prev, next) {
  if (!prev || !next) return 0;
  const plat = Number(prev.lat);
  const plon = Number(prev.lon);
  const nlat = Number(next.lat);
  const nlon = Number(next.lon);
  if (![plat, plon, nlat, nlon].every(Number.isFinite)) return 0;
  if (isNullIsland(plat, plon) || isNullIsland(nlat, nlon)) return 0;
  const prevMs = prev.ms ?? Date.parse(prev.recordedAt || prev.recorded_at || 0);
  const nextMs = next.ms ?? Date.parse(next.recordedAt || next.recorded_at || 0);
  if (!Number.isFinite(prevMs) || !Number.isFinite(nextMs)) return 0;
  if (
    isImpossibleGpsStep(
      { lat: plat, lon: plon, ms: prevMs },
      { lat: nlat, lon: nlon, ms: nextMs },
    )
  ) {
    return 0;
  }
  const d = haversineKm(plat, plon, nlat, nlon);
  return Number.isFinite(d) && d > 0 ? d : 0;
}
