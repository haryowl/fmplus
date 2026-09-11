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

export function placeResultFromPoi(p: ArmadaPoi): PlaceSearchResult | null {
  if (!hasCoords(p.lat, p.lon)) return null;
  const name = (p.name || "").trim() || "POI";
  const cat = (p.categoryName || "").trim();
  return {
    key: `poi:${p.id ?? name}:${p.lat},${p.lon}`,
    source: "poi",
    label: name,
    lat: Number(p.lat),
    lon: Number(p.lon),
    subtitle: cat ? `POI · ${cat}` : "POI",
    customerHint: name,
    zoneHint: cat,
  };
}

/** Sorted POIs for dropdown; optional name/category filter. Always independent of service points. */
export function listPoiDropdownOptions(pois: ArmadaPoi[], filter = ""): ArmadaPoi[] {
  const needle = filter.trim().toLowerCase();
  const out = pois.filter((p) => {
    if (!hasCoords(p.lat, p.lon)) return false;
    if (!needle) return true;
    const hay = `${p.name || ""} ${p.categoryName || ""}`.toLowerCase();
    return hay.includes(needle);
  });
  return out.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));
}

/** Prefetch Armada POIs once for Dispatch (coords required for pinning). */
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
 * Free-text Orders search: service points + street/area (Nominatim).
 * POIs are chosen via the dedicated dropdown, not this path.
 */
export async function searchDispatchPlaces(
  q: string,
  signal?: AbortSignal,
): Promise<PlaceSearchResult[]> {
  const trimmed = q.trim();
  if (trimmed.length < 2) return [];

  const [addrSettled, pointsSettled] = await Promise.allSettled([
    searchAddresses(trimmed, signal),
    fetchServicePoints(trimmed, signal),
  ]);

  const servicePoints: PlaceSearchResult[] = [];
  if (pointsSettled.status === "fulfilled") {
    for (const sp of pointsSettled.value) {
      if (!hasCoords(sp.lat, sp.lon)) continue;
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

  return [...servicePoints, ...addresses];
}

export function placeSearchSourceLabel(source: PlaceSearchSource): string {
  if (source === "poi") return "POI";
  if (source === "service_point") return "Point";
  return "Map";
}
