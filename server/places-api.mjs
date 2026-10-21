/**
 * Phase C — Places analytics (geofence groups + notifier fence hits + soft POI/reports).
 * GET /api/places/summary?days=
 * GET /api/places/pois?q=
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { armadaFetch } from "./armada-fetch.mjs";
import { tenantTelematicsSource } from "./tracker-devices.mjs";

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, obj) {
  send(
    res,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    JSON.stringify(obj),
  );
}

function pickName(row) {
  return String(row?.name ?? row?.Name ?? row?.label ?? row?.Label ?? "").trim();
}

function pickCoord(row, ...keys) {
  for (const key of keys) {
    if (row == null || typeof row !== "object") break;
    if (key in row && row[key] != null && row[key] !== "") {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickPoiLatLon(p) {
  const pos = p?.position ?? p?.Position ?? null;
  const lat = pickCoord(pos, "latitude", "Latitude", "lat", "Lat");
  const lon = pickCoord(pos, "longitude", "Longitude", "lon", "Lon", "lng", "Lng");
  if (lat != null && lon != null) return { lat, lon };
  return {
    lat: pickCoord(p, "lat", "Lat", "latitude", "Latitude"),
    lon: pickCoord(p, "lon", "Lon", "longitude", "Longitude", "lng", "Lng"),
  };
}

function pickId(row) {
  const n = Number(row?.id ?? row?.Id ?? row?.ID);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.Items)) return payload.Items;
  return [];
}

/** Prefer a short human message over raw JSON body like `"Forbidden"`. */
function armadaErrorMessage(status, text, parsed) {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const msg = parsed.message ?? parsed.Message ?? parsed.error ?? parsed.Error;
    if (msg != null && String(msg).trim()) return String(msg).trim().slice(0, 200);
  }
  if (typeof parsed === "string" && parsed.trim()) return parsed.trim().slice(0, 200);
  let t = String(text || "").trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (status === 403) {
    return t && t.toLowerCase() !== "forbidden"
      ? t.slice(0, 200)
      : "Forbidden — this Armada token lacks privilege for this resource";
  }
  return t.slice(0, 200) || `HTTP ${status}`;
}

async function armadaJson(vaultTenant, pathAndQuery) {
  if (!vaultTenant?.token || !vaultTenant?.appId) {
    return { ok: false, status: 0, error: "No Armada tenant token", rows: [] };
  }
  const base = `https://armada.id/lt/api/v.1/applications/${vaultTenant.appId}`;
  const url = `${base}${pathAndQuery}`;
  try {
    const res = await armadaFetch(url, {
      headers: { Authorization: vaultTenant.token, Accept: "application/json" },
      timeoutMs: 30_000,
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      error: res.ok ? null : armadaErrorMessage(res.status, text, parsed),
      rows: res.ok ? asArray(parsed) : [],
      raw: parsed,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      rows: [],
    };
  }
}

function skippedArmadaStatus() {
  return {
    ok: true,
    skipped: true,
    status: 0,
    error: null,
    count: 0,
    available: false,
    categoryCount: 0,
    templates: 0,
  };
}

function fenceNameFromPayload(payload, ruleName) {
  const p = payload && typeof payload === "object" ? payload : {};
  const fromPayload = String(
    p.GEOFENCE_NAME ?? p.GeofenceName ?? p.geofenceName ?? p.GEOFENCE ?? p.FenceName ?? "",
  ).trim();
  if (fromPayload) return fromPayload;
  const rule = String(ruleName || "").trim();
  if (/geofence|geo.?fence|fence/i.test(rule)) return rule;
  return "";
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handlePlacesRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/places")) return false;

  try {
    if (!databaseUrlConfigured()) {
      json(res, 503, { error: "Database not configured" });
      return true;
    }
    const dbTenant = await resolveDbTenant(req);
    if (!dbTenant) {
      json(res, 401, { error: "Tenant key required (k=)" });
      return true;
    }
    const vaultTenant = tenantFromRequest(req);
    const telematicsSource = await tenantTelematicsSource(dbTenant.id).catch(() => "both");
    const useArmada = Boolean(vaultTenant?.token) && telematicsSource !== "devices";

    if (url.pathname === "/api/places/summary" && req.method === "GET") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));

      const emptyArmada = {
        ok: true,
        status: 0,
        error: null,
        rows: [],
      };
      const [groupsRes, fencesRes, poiCatRes, reportsRes, templatesRes] = useArmada
        ? await Promise.all([
            armadaJson(vaultTenant, "/geofencegroups?FromIndex=0&PageSize=200"),
            armadaJson(vaultTenant, "/geofences?FromIndex=0&PageSize=500"),
            armadaJson(vaultTenant, "/poicategories?FromIndex=0&PageSize=50"),
            armadaJson(vaultTenant, "/reports?FromIndex=0&PageSize=50"),
            armadaJson(vaultTenant, "/reporttemplates?FromIndex=0&PageSize=50"),
          ])
        : [emptyArmada, emptyArmada, emptyArmada, emptyArmada, emptyArmada];

      const geofenceGroups = groupsRes.rows.map((r) => ({
        id: pickId(r),
        name: pickName(r) || (pickId(r) != null ? `Group ${pickId(r)}` : "Group"),
      }));
      const geofences = fencesRes.rows.map((r) => ({
        id: pickId(r),
        name: pickName(r) || (pickId(r) != null ? `Fence ${pickId(r)}` : "Fence"),
        groupId: Number(r.groupId ?? r.GroupId ?? r.geofenceGroupId ?? r.GeofenceGroupId) || null,
      }));

      const hits = await dbQuery(
        `SELECT rule_name, event_time, armada_username, user_display_name, payload, created_at
         FROM armada_notifications
         WHERE tenant_id = $1
           AND created_at >= (CURRENT_DATE - ($2::int - 1))::timestamptz
         ORDER BY created_at DESC
         LIMIT 2000`,
        [dbTenant.id, days],
      );

      const byFence = new Map();
      const recent = [];
      const addFenceHit = (fenceName, vehicle, username, at, ruleName) => {
        if (!fenceName) return;
        const key = fenceName.toLowerCase();
        const cur = byFence.get(key) || {
          name: fenceName,
          hits: 0,
          vehicles: new Set(),
          lastAt: null,
        };
        cur.hits += 1;
        if (vehicle) cur.vehicles.add(vehicle);
        if (at && (!cur.lastAt || String(at) > String(cur.lastAt))) cur.lastAt = at;
        byFence.set(key, cur);
        if (recent.length < 40) {
          recent.push({
            fenceName,
            ruleName: ruleName || "",
            vehicle: vehicle || "—",
            username: username || "",
            at: at || null,
          });
        }
      };
      for (const row of hits.rows) {
        addFenceHit(
          fenceNameFromPayload(row.payload, row.rule_name),
          row.user_display_name || row.armada_username || "",
          row.armada_username || "",
          row.event_time || row.created_at,
          row.rule_name || "",
        );
      }
      try {
        const fleetHits = await dbQuery(
          `SELECT e.title, e.detail, e.fired_at, e.payload, d.label, d.imei
           FROM fleet_alert_events e
           LEFT JOIN tracker_devices d ON d.id = e.device_id
           WHERE e.tenant_id = $1
             AND e.fired_at >= (CURRENT_DATE - ($2::int - 1))::timestamptz
             AND (
               e.title ~* 'geofence|geo.?fence|\\bfence\\b'
               OR e.detail ~* 'geofence|geo.?fence|\\bfence\\b'
               OR COALESCE(
                 e.payload->>'GEOFENCE_NAME',
                 e.payload->>'geofenceName',
                 e.payload->>'FenceName',
                 ''
               ) <> ''
             )
           ORDER BY e.fired_at DESC
           LIMIT 500`,
          [dbTenant.id, days],
        );
        for (const row of fleetHits.rows) {
          addFenceHit(
            fenceNameFromPayload(row.payload, row.title || row.detail),
            row.label || row.imei || "",
            row.imei || "",
            row.fired_at,
            row.title || "",
          );
        }
      } catch {
        /* fleet_alert_events may be absent on older DBs */
      }

      const fenceHits = [...byFence.values()]
        .map((f) => ({
          name: f.name,
          hits: f.hits,
          vehicleCount: f.vehicles.size,
          lastAt: f.lastAt,
        }))
        .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));

      const reports = reportsRes.rows.slice(0, 30).map((r) => ({
        id: pickId(r),
        name: pickName(r) || (pickId(r) != null ? `Report ${pickId(r)}` : "Report"),
      }));

      json(res, 200, {
        days,
        telematicsSource,
        geofenceGroups,
        geofences,
        fenceHits,
        recentFenceEvents: recent,
        reports,
        armada: useArmada
          ? {
              geofenceGroups: {
                ok: groupsRes.ok,
                status: groupsRes.status,
                error: groupsRes.error,
                count: geofenceGroups.length,
              },
              geofences: {
                ok: fencesRes.ok,
                status: fencesRes.status,
                error: fencesRes.error,
                count: geofences.length,
              },
              pois: {
                ok: poiCatRes.ok,
                status: poiCatRes.status,
                error: poiCatRes.error,
                available: poiCatRes.ok,
                categoryCount: poiCatRes.rows.length,
              },
              reports: {
                ok: reportsRes.ok,
                status: reportsRes.status,
                error: reportsRes.error,
                count: reportsRes.rows.length,
                templates: templatesRes.ok ? templatesRes.rows.length : 0,
              },
            }
          : {
              geofenceGroups: skippedArmadaStatus(),
              geofences: skippedArmadaStatus(),
              pois: skippedArmadaStatus(),
              reports: skippedArmadaStatus(),
            },
      });
      return true;
    }

    if (url.pathname === "/api/places/pois" && req.method === "GET") {
      if (!useArmada) {
        json(res, 200, {
          available: false,
          skipped: true,
          status: 0,
          error: "Armada POI is not used on devices-only tenants",
          pois: [],
        });
        return true;
      }
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const cats = await armadaJson(vaultTenant, "/poicategories?FromIndex=0&PageSize=100");
      if (!cats.ok) {
        json(res, 200, {
          available: false,
          status: cats.status,
          error:
            cats.status === 403
              ? "Armada denied POI categories for this token. Enable POI privilege in Armada, then retry."
              : cats.error || "POI categories unavailable",
          pois: [],
        });
        return true;
      }
      const pois = [];
      for (const cat of cats.rows.slice(0, 20)) {
        const catId = pickId(cat);
        if (catId == null) continue;
        const list = await armadaJson(
          vaultTenant,
          `/poicategories/${catId}/pois?FromIndex=0&PageSize=200`,
        );
        if (!list.ok) continue;
        for (const p of list.rows) {
          const name = pickName(p);
          if (q && !name.toLowerCase().includes(q)) continue;
          const { lat, lon } = pickPoiLatLon(p);
          pois.push({
            id: pickId(p),
            name: name || `POI ${pickId(p) || "?"}`,
            categoryId: catId,
            categoryName: pickName(cat),
            lat,
            lon,
          });
        }
      }
      json(res, 200, { available: true, status: 200, error: null, pois: pois.slice(0, 300) });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[places]", message);
    json(res, 500, { error: message });
    return true;
  }
}
