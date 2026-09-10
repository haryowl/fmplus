import { tenantHeaders } from "./tenant";

export type GeocodeResult = {
  label: string;
  lat: number;
  lon: number;
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
