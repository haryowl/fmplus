import { tenantHeaders } from "./tenant";
import { fetchPlacesPois, type ArmadaPoi } from "./places";
import { fetchServicePoints } from "./maintenance";

export type GeocodeResult = {
  label: string;
  lat: number;
  lon: number;
};

export type PlaceSearchSource = "poi" | "service_point" | "address";

export type PlaceSearchResult = GeocodeResult & {
  source: PlaceSearchSource;
  /** Secondary line in the result list */
  subtitle?: string;
  /** Prefill customer name when empty */
  customerHint?: string;
  /** Prefill zone when empty */
  zoneHint?: string;
  /** Stable list key */
  key: string;
};

export async function searchAddresses(
  q: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];
  const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(trimmed)}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as {
    results?: GeocodeResult[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Geocode search ${res.status}`);
  return data.results || [];
}

export async function reverseAddress(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<GeocodeResult> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await fetch(`/api/geocode/reverse?${params}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as GeocodeResult & { error?: string };
  if (!res.ok) throw new Error(data.error || `Geocode reverse ${res.status}`);
  return {
    label: data.label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lat: Number.isFinite(data.lat) ? data.lat : lat,
    lon: Number.isFinite(data.lon) ? data.lon : lon,
  };
}

function hasCoords(lat: number | null | undefined, lon: number | null | undefined): boolean {
  return (
    lat != null &&
    lon != null &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lon)) &&
    !(Number(lat) === 0 && Number(lon) === 0)
  );
}

export function filterPoisForSearch(pois: ArmadaPoi[], q: string, limit = 8): PlaceSearchResult[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const out: PlaceSearchResult[] = [];
  for (const p of pois) {
    if (!hasCoords(p.lat, p.lon)) continue;
    const name = (p.name || "").trim();
    const cat = (p.categoryName || "").trim();
    const hay = `${name} ${cat}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    out.push({
      key: `poi:${p.id ?? name}:${p.lat},${p.lon}`,
      source: "poi",
      label: name || "POI",
      lat: Number(p.lat),
      lon: Number(p.lon),
      subtitle: cat ? `POI · ${cat}` : "POI",
      customerHint: name,
      zoneHint: cat,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Prefetch Armada POIs once for Dispatch search (filters client-side). */
export async function loadDispatchPoiCatalog(signal?: AbortSignal): Promise<ArmadaPoi[]> {
  try {
    const res = await fetchPlacesPois("", signal);
    if (!res.available) return [];
    return (res.pois || []).filter((p) => hasCoords(p.lat, p.lon));
  } catch {
    return [];
  }
}

/**
 * Orders place search: saved POIs + service points + street/area (Nominatim).
 * POI list should be prefetched; service points / addresses fetch per query.
 */
export async function searchDispatchPlaces(
  q: string,
  poiCatalog: ArmadaPoi[],
  signal?: AbortSignal,
): Promise<PlaceSearchResult[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];

  const pois = filterPoisForSearch(poiCatalog, trimmed, 8);

  const [addrSettled, pointsSettled] = await Promise.allSettled([
    searchAddresses(trimmed, signal),
    fetchServicePoints(trimmed, signal),
  ]);

  const linkedPoiIds = new Set<number>();
  const servicePoints: PlaceSearchResult[] = [];
  if (pointsSettled.status === "fulfilled") {
    for (const sp of pointsSettled.value) {
      if (!hasCoords(sp.lat, sp.lon)) continue;
      if (sp.armadaPoiId != null) linkedPoiIds.add(Number(sp.armadaPoiId));
      const name = (sp.name || "").trim() || "Service point";
      const type = (sp.pointType || "").trim();
      servicePoints.push({
        key: `sp:${sp.id}`,
        source: "service_point",
        label: name,
        lat: Number(sp.lat),
        lon: Number(sp.lon),
        subtitle: type ? `Service point · ${type}` : "Service point",
        customerHint: name,
        zoneHint: type,
      });
      if (servicePoints.length >= 8) break;
    }
  }

  // Drop POIs already represented by a linked service point
  const poisDeduped = pois.filter((p) => {
    const idMatch = /^poi:(\d+):/.exec(p.key);
    if (!idMatch) return true;
    return !linkedPoiIds.has(Number(idMatch[1]));
  });

  const addresses: PlaceSearchResult[] = [];
  if (addrSettled.status === "fulfilled") {
    for (const a of addrSettled.value.slice(0, 8)) {
      if (!hasCoords(a.lat, a.lon)) continue;
      addresses.push({
        key: `addr:${a.lat},${a.lon}:${a.label}`,
        source: "address",
        label: a.label,
        lat: a.lat,
        lon: a.lon,
        subtitle: "Street / area",
      });
    }
  }

  return [...servicePoints, ...poisDeduped, ...addresses];
}

export function placeSearchSourceLabel(source: PlaceSearchSource): string {
  if (source === "poi") return "POI";
  if (source === "service_point") return "Point";
  return "Map";
}
