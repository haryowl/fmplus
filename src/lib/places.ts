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
  skipped?: boolean;
};

export type NativeGeofence = {
  id: string;
  name: string;
  kind: "circle" | "polygon";
  lat: number | null;
  lon: number | null;
  radiusM: number | null;
  ring: Array<[number, number]>;
  color: string;
  enabled: boolean;
};

export type PlacesSummary = {
  days: number;
  telematicsSource?: "armada" | "devices" | "both";
  geofenceGroups: { id: number | null; name: string }[];
  geofences: { id: number | null; name: string; groupId: number | null }[];
  nativeGeofences?: NativeGeofence[];
  nativePoiCount?: number;
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
      ok: Boolean(armada.geofenceGroups.ok || armada.geofenceGroups.skipped),
      detail: armada.geofenceGroups.skipped
        ? "Not used on this tenant"
        : armada.geofenceGroups.ok
          ? `${armada.geofenceGroups.count ?? summary.geofenceGroups.length} groups`
          : armada.geofenceGroups.error || `HTTP ${armada.geofenceGroups.status}`,
    },
    {
      label: "Geofences",
      ok: Boolean(armada.geofences.ok || armada.geofences.skipped),
      detail: armada.geofences.skipped
        ? "Not used on this tenant"
        : armada.geofences.ok
          ? `${armada.geofences.count ?? summary.geofences.length} fences`
          : armada.geofences.error || `HTTP ${armada.geofences.status}`,
    },
    {
      label: "POI categories",
      ok: Boolean(armada.pois.skipped || armada.pois.available || armada.pois.ok),
      detail: armada.pois.skipped
        ? summary.nativePoiCount
          ? `${summary.nativePoiCount} native places`
          : "Native service points (no Armada POI)"
        : armada.pois.available || armada.pois.ok
          ? `${armada.pois.categoryCount ?? 0} categories`
          : armada.pois.error || `HTTP ${armada.pois.status}`,
    },
    {
      label: "Reports",
      ok: Boolean(armada.reports.ok || armada.reports.skipped),
      detail: armada.reports.skipped
        ? "Not used on this tenant"
        : armada.reports.ok
          ? `${armada.reports.count ?? 0} reports · ${armada.reports.templates ?? 0} templates`
          : armada.reports.error || `HTTP ${armada.reports.status}`,
    },
  ];
}

export type ArmadaPoi = {
  id: number | string | null;
  name: string;
  categoryId: number | null;
  categoryName: string;
  lat: number | null;
  lon: number | null;
  source?: "armada" | "native";
};

export type PlacesPoisResponse = {
  available: boolean;
  status: number;
  error: string | null;
  native?: boolean;
  skipped?: boolean;
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

export async function fetchNativeGeofences(signal?: AbortSignal): Promise<NativeGeofence[]> {
  const res = await fetch("/api/places/geofences", {
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { geofences?: NativeGeofence[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Geofences ${res.status}`);
  return data.geofences || [];
}

export async function createNativeGeofence(body: {
  name: string;
  kind?: "circle" | "polygon";
  lat?: number | null;
  lon?: number | null;
  radiusM?: number | null;
  ring?: Array<[number, number]>;
  color?: string;
}): Promise<NativeGeofence> {
  const res = await fetch("/api/places/geofences", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify({ kind: body.kind || "circle", ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as { geofence?: NativeGeofence; error?: string };
  if (!res.ok) throw new Error(data.error || `Create geofence ${res.status}`);
  if (!data.geofence) throw new Error("Create failed");
  return data.geofence;
}

export async function deleteNativeGeofence(id: string): Promise<void> {
  const res = await fetch(`/api/places/geofences/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Delete geofence ${res.status}`);
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
