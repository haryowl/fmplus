/**
 * Native tenant geofences (Places catalog + Fleet Live overlay + alert snap).
 */
import { dbQuery } from "./db.mjs";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pointInCircle(lat, lon, fence) {
  const r = Number(fence.radiusM ?? fence.radius_m);
  const fLat = Number(fence.lat);
  const fLon = Number(fence.lon);
  if (![lat, lon, r, fLat, fLon].every(Number.isFinite) || r <= 0) return false;
  return haversineM(lat, lon, fLat, fLon) <= r;
}

/** Ray-cast. Ring is [[lat, lon], ...]. */
export function pointInRing(lat, lon, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = Number(ring[i]?.[0]);
    const xi = Number(ring[i]?.[1]);
    const yj = Number(ring[j]?.[0]);
    const xj = Number(ring[j]?.[1]);
    if (![yi, xi, yj, xj].every(Number.isFinite)) continue;
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInFence(lat, lon, fence) {
  if (!fence || fence.enabled === false) return false;
  const kind = String(fence.kind || "circle");
  if (kind === "polygon") return pointInRing(lat, lon, fence.ring);
  return pointInCircle(lat, lon, fence);
}

export function fencesContaining(lat, lon, fences) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return [];
  return (fences || []).filter((f) => pointInFence(Number(lat), Number(lon), f));
}

function normalizeColor(v) {
  const s = String(v || "").trim();
  return COLOR_RE.test(s) ? s : "#2563eb";
}

function normalizeRing(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lat = Number(pair[0]);
    const lon = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push([lat, lon]);
  }
  return out;
}

export function publicGeofence(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind || "circle",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    radiusM: row.radius_m == null ? null : Number(row.radius_m),
    ring: normalizeRing(row.ring),
    color: row.color || "#2563eb",
    enabled: row.enabled !== false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function listTenantGeofences(tenantId, { enabledOnly = false } = {}) {
  const rows = await dbQuery(
    `SELECT id, name, kind, lat, lon, radius_m, ring, color, enabled, created_at, updated_at
     FROM tenant_geofences
     WHERE tenant_id = $1 ${enabledOnly ? "AND enabled = true" : ""}
     ORDER BY lower(name) ASC`,
    [tenantId],
  );
  return rows.rows.map(publicGeofence);
}

export function parseGeofenceBody(body, { partial = false } = {}) {
  const out = {};
  if (!partial || "name" in body) {
    const name = String(body?.name || "").trim().slice(0, 120);
    if (!name) {
      const err = new Error("name is required");
      err.status = 400;
      throw err;
    }
    out.name = name;
  }
  if (!partial || "kind" in body) {
    const kind = String(body?.kind || "circle").trim().toLowerCase();
    out.kind = kind === "polygon" ? "polygon" : "circle";
  }
  if (!partial || "lat" in body) {
    const lat = body?.lat == null || body.lat === "" ? null : Number(body.lat);
    out.lat = Number.isFinite(lat) ? lat : null;
  }
  if (!partial || "lon" in body) {
    const lon = body?.lon == null || body.lon === "" ? null : Number(body.lon);
    out.lon = Number.isFinite(lon) ? lon : null;
  }
  if (!partial || "radiusM" in body || "radius_m" in body) {
    const r = Number(body?.radiusM ?? body?.radius_m);
    out.radiusM = Number.isFinite(r) && r > 0 ? Math.min(200_000, Math.max(10, r)) : null;
  }
  if (!partial || "ring" in body) {
    out.ring = normalizeRing(body?.ring);
  }
  if (!partial || "color" in body) {
    out.color = normalizeColor(body?.color);
  }
  if (!partial || "enabled" in body) {
    out.enabled = body?.enabled !== false;
  }
  const kind = out.kind || "circle";
  if (kind === "circle" && !partial) {
    if (out.lat == null || out.lon == null || !out.radiusM) {
      const err = new Error("circle geofence needs lat, lon, and radiusM");
      err.status = 400;
      throw err;
    }
  }
  if (kind === "polygon" && !partial && out.ring.length < 3) {
    const err = new Error("polygon geofence needs at least 3 ring points");
    err.status = 400;
    throw err;
  }
  return out;
}

export async function createTenantGeofence(tenantId, body) {
  const f = parseGeofenceBody(body);
  const inserted = await dbQuery(
    `INSERT INTO tenant_geofences (tenant_id, name, kind, lat, lon, radius_m, ring, color, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING id, name, kind, lat, lon, radius_m, ring, color, enabled, created_at, updated_at`,
    [
      tenantId,
      f.name,
      f.kind,
      f.lat,
      f.lon,
      f.radiusM,
      JSON.stringify(f.ring || []),
      f.color,
      f.enabled !== false,
    ],
  );
  return publicGeofence(inserted.rows[0]);
}

export async function updateTenantGeofence(tenantId, id, body) {
  const f = parseGeofenceBody(body, { partial: true });
  const sets = [];
  const params = [];
  const push = (col, val) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if ("name" in f) push("name", f.name);
  if ("kind" in f) push("kind", f.kind);
  if ("lat" in f) push("lat", f.lat);
  if ("lon" in f) push("lon", f.lon);
  if ("radiusM" in f) push("radius_m", f.radiusM);
  if ("ring" in f) {
    params.push(JSON.stringify(f.ring || []));
    sets.push(`ring = $${params.length}::jsonb`);
  }
  if ("color" in f) push("color", f.color);
  if ("enabled" in f) push("enabled", f.enabled);
  if (!sets.length) {
    const err = new Error("No fields to update");
    err.status = 400;
    throw err;
  }
  sets.push("updated_at = now()");
  params.push(id, tenantId);
  const updated = await dbQuery(
    `UPDATE tenant_geofences SET ${sets.join(", ")}
     WHERE id = $${params.length - 1}::uuid AND tenant_id = $${params.length}
     RETURNING id, name, kind, lat, lon, radius_m, ring, color, enabled, created_at, updated_at`,
    params,
  );
  return updated.rows[0] ? publicGeofence(updated.rows[0]) : null;
}

export async function deleteTenantGeofence(tenantId, id) {
  const res = await dbQuery(
    `DELETE FROM tenant_geofences WHERE tenant_id = $1 AND id = $2::uuid RETURNING id`,
    [tenantId, id],
  );
  return Boolean(res.rows[0]);
}

/** Cooked snap fields for Fleet Live alert rules. */
export function geofenceSnapFields(lat, lon, fences) {
  const hits = fencesContaining(lat, lon, fences);
  return {
    inside_geofence: hits.length > 0,
    geofence_name: hits.map((f) => f.name).filter(Boolean).join(", "),
  };
}
