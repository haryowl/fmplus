/** Display-only unit conversion. Storage and trip math stay SI (km, km/h, metres, decimal degrees). */

export const UNIT_STORAGE_KEY = "fmplus.unitSystem";
export const KM_PER_NAUTICAL_MILE = 1.852;
export const FEET_PER_METRE = 3.28084;

export type UnitSystem = "metric" | "nautical";

export function isUnitSystem(value: unknown): value is UnitSystem {
  return value === "metric" || value === "nautical";
}

export function readStoredUnitSystem(): UnitSystem {
  try {
    const raw = localStorage.getItem(UNIT_STORAGE_KEY);
    if (isUnitSystem(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "metric";
}

export function writeStoredUnitSystem(system: UnitSystem): void {
  try {
    localStorage.setItem(UNIT_STORAGE_KEY, system);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fmplus:unitSystem", { detail: system }));
  }
}

export function kmToDisplay(km: number, system: UnitSystem): number {
  if (!Number.isFinite(km)) return km;
  return system === "nautical" ? km / KM_PER_NAUTICAL_MILE : km;
}

export function kmhToDisplay(kmh: number, system: UnitSystem): number {
  return kmToDisplay(kmh, system);
}

export function metresToDisplay(m: number, system: UnitSystem): number {
  if (!Number.isFinite(m)) return m;
  return system === "nautical" ? m * FEET_PER_METRE : m;
}

export function distanceUnit(system: UnitSystem): string {
  return system === "nautical" ? "NM" : "km";
}

export function speedUnit(system: UnitSystem): string {
  return system === "nautical" ? "kn" : "km/h";
}

export function altitudeUnit(system: UnitSystem): string {
  return system === "nautical" ? "ft" : "m";
}

function fmt1(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatDistance(km: number, system: UnitSystem, withUnit = true): string {
  const n = kmToDisplay(km, system);
  const body = fmt1(n);
  return withUnit ? `${body} ${distanceUnit(system)}` : body;
}

export function formatSpeedValue(kmh: number, system: UnitSystem, withUnit = true): string {
  const n = kmhToDisplay(kmh, system);
  const body = fmt1(n);
  return withUnit ? `${body} ${speedUnit(system)}` : body;
}

export function formatAltitude(m: number, system: UnitSystem, withUnit = true): string {
  const n = metresToDisplay(m, system);
  const body = Math.round(n).toLocaleString("en-US");
  return withUnit ? `${body} ${altitudeUnit(system)}` : body;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Decimal degrees → DMS, e.g. 4°12'33.2"S */
export function formatDms(deg: number, kind: "lat" | "lon"): string {
  if (!Number.isFinite(deg)) return "—";
  const hemi =
    kind === "lat" ? (deg < 0 ? "S" : "N") : deg < 0 ? "W" : "E";
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  let m = Math.floor(minFloat);
  let s = (minFloat - m) * 60;
  if (s >= 59.95) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
  }
  const sec = s.toFixed(1);
  return `${d}°${pad2(m)}'${sec.padStart(4, "0")}"${hemi}`;
}

export function formatCoord(lat: number, lon: number, system: UnitSystem): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "—";
  if (system === "nautical") {
    return `${formatDms(lat, "lat")} ${formatDms(lon, "lon")}`;
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export const UNIT_SYSTEM_OPTIONS: Array<{ value: UnitSystem; label: string }> = [
  { value: "metric", label: "Metric · km" },
  { value: "nautical", label: "Nautical · NM" },
];
