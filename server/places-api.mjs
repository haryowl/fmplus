/**
 * Phase C — Places analytics (geofence groups + notifier fence hits + soft POI/reports).
 * GET /api/places/summary?days=
 * GET /api/places/pois?q=
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { tenantFromRequest } from "./tenants.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { armadaFetch } from "./armada-fetch.mjs";

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
      error: res.ok ? null : text.slice(0, 200) || `HTTP ${res.status}`,
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
    const vaultTenant = tenantFromRequest(req);
    if (!vaultTenant?.key) {
      json(res, 401, { error: "Tenant key required (k=)" });
      return true;
    }
    const found = await dbQuery(
      `SELECT id, key FROM tenants WHERE key = $1 AND enabled = true`,
      [vaultTenant.key],
    );
    if (!found.rows[0]) {
      json(res, 404, { error: "Tenant not found" });
      return true;
    }
    const dbTenant = found.rows[0];

    if (url.pathname === "/api/places/summary" && req.method === "GET") {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));

      const [groupsRes, fencesRes, poiCatRes, reportsRes, templatesRes] = await Promise.all([
        armadaJson(vaultTenant, "/geofencegroups?FromIndex=0&PageSize=200"),
        armadaJson(vaultTenant, "/geofences?FromIndex=0&PageSize=500"),
        armadaJson(vaultTenant, "/poicategories?FromIndex=0&PageSize=50"),
        armadaJson(vaultTenant, "/reports?FromIndex=0&PageSize=50"),
        armadaJson(vaultTenant, "/reporttemplates?FromIndex=0&PageSize=50"),
      ]);

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
      for (const row of hits.rows) {
        const fenceName = fenceNameFromPayload(row.payload, row.rule_name);
        if (!fenceName) continue;
        const key = fenceName.toLowerCase();
        const cur = byFence.get(key) || {
          name: fenceName,
          hits: 0,
          vehicles: new Set(),
          lastAt: null,
        };
        cur.hits += 1;
        const vehicle = row.user_display_name || row.armada_username || "";
        if (vehicle) cur.vehicles.add(vehicle);
        const at = row.event_time || row.created_at;
        if (at && (!cur.lastAt || String(at) > String(cur.lastAt))) cur.lastAt = at;
        byFence.set(key, cur);
        if (recent.length < 40) {
          recent.push({
            fenceName,
            ruleName: row.rule_name || "",
            vehicle: vehicle || "—",
            username: row.armada_username || "",
            at: at || null,
          });
        }
      }

      const fenceHits = [...byFence.values()]
        .map((f) => ({
          name: f.name,
          hits: f.hits,
          vehicleCount: f.vehicles.size,
          lastAt: f.lastAt,
        }))
        .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name));

      json(res, 200, {
        days,
        geofenceGroups,
        geofences,
        fenceHits,
        recentFenceEvents: recent,
        armada: {
          geofenceGroups: { ok: groupsRes.ok, status: groupsRes.status, error: groupsRes.error },
          geofences: { ok: fencesRes.ok, status: fencesRes.status, error: fencesRes.error, count: geofences.length },
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
            count: reportsRes.rows.length,
            templates: templatesRes.ok ? templatesRes.rows.length : 0,
          },
        },
      });
      return true;
    }

    if (url.pathname === "/api/places/pois" && req.method === "GET") {
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
          pois.push({
            id: pickId(p),
            name: name || `POI ${pickId(p) || "?"}`,
            categoryId: catId,
            categoryName: pickName(cat),
            lat: Number(p.lat ?? p.Lat ?? p.latitude ?? p.Latitude) || null,
            lon: Number(p.lon ?? p.Lon ?? p.longitude ?? p.Longitude) || null,
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
