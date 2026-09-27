import { asMapCoord } from "./mapCoords";

type PhoneStop = {
  startPhoneLat?: number | null;
  startPhoneLon?: number | null;
  phoneLat?: number | null;
  phoneLon?: number | null;
};

type PhoneDriver = {
  stops?: PhoneStop[];
  phonePos?: { lat: number; lon: number } | null;
};

function pushCoord(out: [number, number][], lat: unknown, lon: unknown) {
  const c = asMapCoord(lat, lon);
  if (!c) return;
  const last = out[out.length - 1];
  if (last && last[0] === c[0] && last[1] === c[1]) return;
  out.push(c);
}

/**
 * Prefer the continuous phone trail. If it is too short to draw (duty pings
 * missing or clipped away), stitch start/complete/live phone dots so Live still
 * shows a line the way Armada falls back to stop crumbs.
 */
export function phoneTrailOrCrumbs(
  trail: [number, number][] | undefined | null,
  driver: PhoneDriver,
): [number, number][] {
  const line: [number, number][] = [];
  for (const p of trail || []) pushCoord(line, p[0], p[1]);
  if (line.length >= 2) return line;

  const crumbs: [number, number][] = [];
  for (const s of driver.stops || []) {
    pushCoord(crumbs, s.startPhoneLat, s.startPhoneLon);
    pushCoord(crumbs, s.phoneLat, s.phoneLon);
  }
  if (driver.phonePos) pushCoord(crumbs, driver.phonePos.lat, driver.phonePos.lon);
  return crumbs.length >= 2 ? crumbs : line;
}
