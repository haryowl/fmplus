import { mapPool } from "./pool";

/** Round to ~1.1 m so nearby segment ends share one lookup. */
export function geocodeCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Build a readable line from GpsGate location part fields. */
export function formatLocationParts(row: Record<string, unknown>): string {
  const street = [asTrimmedString(row.streetNumber), asTrimmedString(row.streetName)]
    .filter(Boolean)
    .join(" ");
  const parts = [
    street,
    asTrimmedString(row.streetBox),
    asTrimmedString(row.cityName),
    asTrimmedString(row.subAdministrativeAreaName),
    asTrimmedString(row.administrativeAreaName),
    asTrimmedString(row.postalCodeNumber),
    asTrimmedString(row.countryName),
  ].filter(Boolean);
  return [...new Set(parts)].join(", ");
}

/** Parse GpsGate/Armada reversegeocode JSON (shape varies by geocoder). */
export function parseReverseGeocodeAddress(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (!raw || typeof raw !== "object") return "";

  const row = raw as Record<string, unknown>;
  for (const key of [
    "formattedResult",
    "address",
    "Address",
    "formattedAddress",
    "formatted_address",
    "label",
    "name",
    "displayName",
    "text",
  ]) {
    const value = asTrimmedString(row[key]);
    if (value) return value;
  }

  if (row.location !== undefined) {
    const nested = parseReverseGeocodeAddress(row.location);
    if (nested) return nested;
  }
  if (row.result !== undefined) {
    const nested = parseReverseGeocodeAddress(row.result);
    if (nested) return nested;
  }
  if (row.data !== undefined) {
    const nested = parseReverseGeocodeAddress(row.data);
    if (nested) return nested;
  }
  if (Array.isArray(row.results) && row.results[0] !== undefined) {
    const nested = parseReverseGeocodeAddress(row.results[0]);
    if (nested) return nested;
  }

  return formatLocationParts(row);
}

const sessionCache = new Map<string, string>();

export function clearReverseGeocodeCache(): void {
  sessionCache.clear();
}

export type LatLon = { lat: number; lon: number };

/**
 * Resolve unique rounded lat/lon pairs via `fetcher`.
 * Empty string means no address (failed or geocoder empty).
 */
export async function resolveAddressesForCoords(
  coords: LatLon[],
  fetcher: (lat: number, lon: number, signal?: AbortSignal) => Promise<string>,
  options?: { concurrency?: number; signal?: AbortSignal },
): Promise<Record<string, string>> {
  const unique = new Map<string, LatLon>();
  for (const c of coords) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    const key = geocodeCacheKey(c.lat, c.lon);
    if (!unique.has(key)) unique.set(key, c);
  }

  const out: Record<string, string> = {};
  const jobs = [...unique.entries()].filter(([key]) => {
    if (sessionCache.has(key)) {
      out[key] = sessionCache.get(key)!;
      return false;
    }
    return true;
  });

  await mapPool(jobs, options?.concurrency ?? 4, async ([key, c]) => {
    if (options?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    let address = "";
    try {
      address = (await fetcher(c.lat, c.lon, options?.signal)).trim();
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      address = "";
    }
    sessionCache.set(key, address);
    out[key] = address;
  });

  return out;
}

export function addressAt(
  addresses: Record<string, string>,
  lat: number | null,
  lon: number | null,
): string {
  if (lat === null || lon === null) return "";
  return addresses[geocodeCacheKey(lat, lon)] || "";
}

export function coordsFromSegments(
  segments: Array<{
    startLat: number | null;
    startLon: number | null;
    endLat: number | null;
    endLon: number | null;
  }>,
): LatLon[] {
  const out: LatLon[] = [];
  for (const seg of segments) {
    if (seg.startLat !== null && seg.startLon !== null) {
      out.push({ lat: seg.startLat, lon: seg.startLon });
    }
    if (seg.endLat !== null && seg.endLon !== null) {
      out.push({ lat: seg.endLat, lon: seg.endLon });
    }
  }
  return out;
}
