import { tenantHeaders } from "./tenant";

export type PlacesFenceHit = {
  name: string;
  hits: number;
  vehicleCount: number;
  lastAt: string | null;
};

export type PlacesRecentFenceEvent = {
  fenceName: string;
  ruleName: string;
  vehicle: string;
  username: string;
  at: string | null;
};

export type PlacesArmadaStatus = {
  ok: boolean;
  status: number;
  error?: string | null;
  count?: number;
  available?: boolean;
  categoryCount?: number;
  templates?: number;
};

export type PlacesSummary = {
  days: number;
  geofenceGroups: { id: number | null; name: string }[];
  geofences: { id: number | null; name: string; groupId: number | null }[];
  fenceHits: PlacesFenceHit[];
  recentFenceEvents: PlacesRecentFenceEvent[];
  reports?: { id: number | null; name: string }[];
  armada: {
    geofenceGroups: PlacesArmadaStatus;
    geofences: PlacesArmadaStatus;
    pois: PlacesArmadaStatus;
    reports: PlacesArmadaStatus;
  };
};

export function placesAccessRows(summary: PlacesSummary): {
  label: string;
  ok: boolean;
  detail: string;
}[] {
  const { armada } = summary;
  return [
    {
      label: "Geofence groups",
      ok: armada.geofenceGroups.ok,
      detail: armada.geofenceGroups.ok
        ? `${armada.geofenceGroups.count ?? summary.geofenceGroups.length} groups`
        : armada.geofenceGroups.error || `HTTP ${armada.geofenceGroups.status}`,
    },
    {
      label: "Geofences",
      ok: armada.geofences.ok,
      detail: armada.geofences.ok
        ? `${armada.geofences.count ?? summary.geofences.length} fences`
        : armada.geofences.error || `HTTP ${armada.geofences.status}`,
    },
    {
      label: "POI categories",
      ok: Boolean(armada.pois.available ?? armada.pois.ok),
      detail: armada.pois.available || armada.pois.ok
        ? `${armada.pois.categoryCount ?? 0} categories`
        : armada.pois.error || `HTTP ${armada.pois.status}`,
    },
    {
      label: "Reports",
      ok: armada.reports.ok,
      detail: armada.reports.ok
        ? `${armada.reports.count ?? 0} reports · ${armada.reports.templates ?? 0} templates`
        : armada.reports.error || `HTTP ${armada.reports.status}`,
    },
  ];
}

export type ArmadaPoi = {
  id: number | null;
  name: string;
  categoryId: number;
  categoryName: string;
  lat: number | null;
  lon: number | null;
};

export type PlacesPoisResponse = {
  available: boolean;
  status: number;
  error: string | null;
  pois: ArmadaPoi[];
};

export async function fetchPlacesSummary(days = 30, signal?: AbortSignal): Promise<PlacesSummary> {
  const res = await fetch(`/api/places/summary?days=${encodeURIComponent(String(days))}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as PlacesSummary & { error?: string };
  if (!res.ok) throw new Error(data.error || `Places ${res.status}`);
  return data;
}

export async function fetchPlacesPois(q = "", signal?: AbortSignal): Promise<PlacesPoisResponse> {
  const res = await fetch(`/api/places/pois?q=${encodeURIComponent(q)}`, {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as PlacesPoisResponse & { error?: string };
  if (!res.ok) throw new Error(data.error || `POIs ${res.status}`);
  return data;
}

export function formatPlacesWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}
