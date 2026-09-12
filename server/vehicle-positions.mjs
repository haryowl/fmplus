/**
 * Parse lat/lon from Armada /usersstatus for route start points.
 */
import { armadaFetch } from "./armada-fetch.mjs";

function cleanCoord(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null;
  return { lat: a, lon: b };
}

/**
 * @param {unknown} item
 * @returns {{ userId: number, lat: number, lon: number, label: string } | null}
 */
export function positionFromStatusItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const row = /** @type {Record<string, unknown>} */ (item);
  const userId = Number(row.userId ?? row.id);
  if (!Number.isInteger(userId) || userId < 1) return null;
  const position =
    row.position && typeof row.position === "object" && !Array.isArray(row.position)
      ? /** @type {Record<string, unknown>} */ (row.position)
      : {};
  const coords = cleanCoord(position.latitude, position.longitude);
  if (!coords) return null;
  const name = String(row.name || row.username || row.userName || "").trim();
  return {
    userId,
    lat: coords.lat,
    lon: coords.lon,
    label: name ? `${name} (last position)` : `Vehicle ${userId} (last position)`,
  };
}

/**
 * @param {unknown} raw
 * @returns {Map<number, { lat: number, lon: number, label: string }>}
 */
export function positionMapFromUsersStatus(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray(/** @type {any} */ (raw).items)
      ? /** @type {any} */ (raw).items
      : [];
  /** @type {Map<number, { lat: number, lon: number, label: string }>} */
  const out = new Map();
  for (const item of list) {
    const parsed = positionFromStatusItem(item);
    if (parsed) out.set(parsed.userId, { lat: parsed.lat, lon: parsed.lon, label: parsed.label });
  }
  return out;
}

/**
 * @param {{ appId: number, token: string }} vaultTenant
 * @returns {Promise<Map<number, { lat: number, lon: number, label: string }>>}
 */
export async function fetchVehiclePositions(vaultTenant) {
  if (!vaultTenant?.appId || !vaultTenant?.token) return new Map();
  const url = `https://armada.id/lt/api/v.1/applications/${vaultTenant.appId}/usersstatus`;
  try {
    const res = await armadaFetch(url, {
      method: "GET",
      headers: {
        authorization: vaultTenant.token,
        accept: "application/json",
      },
      timeoutMs: 45_000,
    });
    if (!res.ok) return new Map();
    const raw = await res.json();
    return positionMapFromUsersStatus(raw);
  } catch {
    return new Map();
  }
}
