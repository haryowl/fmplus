/**
 * HTTP/JSON GPS ingest for trackers and lab tools.
 *
 *   POST /api/tracker/ingest/v1/fix
 *   Authorization: Bearer <device-auth-token>
 *   Body: { lat, lon, recordedAt?, speed?, heading?, ignition?, odometer?, altitude?, satellites?, imei?, attrs? }
 *
 * Also accepts X-Device-Token header.
 */
import { databaseUrlConfigured } from "./db.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
import {
  findDeviceByAuthToken,
  findDeviceByImei,
  ingestVehicleFix,
  listTenantLastFixes,
  telematicsUsesDevices,
  tenantTelematicsSource,
} from "./tracker-devices.mjs";

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

function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const auth = String(req.headers.authorization || "");
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  const x = String(req.headers["x-device-token"] || "").trim();
  return x || "";
}

export async function handleTrackerIngestRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/tracker/")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  if (url.pathname === "/api/tracker/health" && req.method === "GET") {
    json(res, 200, { ok: true, service: "tracker-ingest" });
    return true;
  }

  if (url.pathname === "/api/tracker/last-status" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const source = await tenantTelematicsSource(dbTenant.id);
      if (!telematicsUsesDevices(source)) {
        json(res, 200, { fixes: [], telematicsSource: source });
        return true;
      }
      const groupIds = [
        ...url.searchParams.getAll("groupId"),
        ...String(url.searchParams.get("groupIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ];
      const fixes = await listTenantLastFixes(dbTenant.id, { groupIds });
      json(res, 200, { fixes, telematicsSource: source });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/device-groups" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const { listDeviceGroups } = await import("./tracker-device-groups.mjs");
      const groups = await listDeviceGroups(dbTenant.id);
      json(res, 200, { groups });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/safety-events" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const { listSafetyEvents } = await import("./device-manager.mjs");
      const { dbQuery } = await import("./db.mjs");
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 40));
      const deviceId = String(url.searchParams.get("deviceId") || "").trim() || undefined;
      const events = await listSafetyEvents(dbTenant.id, { deviceId, limit });
      const ids = [...new Set(events.map((e) => e.deviceId).filter(Boolean))];
      /** @type {Map<string, { label: string, imei: string }>} */
      const byDevice = new Map();
      if (ids.length) {
        const rows = await dbQuery(
          `SELECT id, label, imei FROM tracker_devices WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [dbTenant.id, ids],
        );
        for (const r of rows.rows) {
          byDevice.set(r.id, { label: r.label || r.imei, imei: r.imei });
        }
      }
      json(res, 200, {
        events: events.map((e) => {
          const d = byDevice.get(e.deviceId);
          return {
            ...e,
            deviceLabel: d?.label || "",
            imei: d?.imei || "",
          };
        }),
      });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/ingest/v1/fix" && req.method === "POST") {
    try {
      const token = bearerToken(req);
      const raw = await readBody(req);
      const body = raw.trim() ? JSON.parse(raw) : {};
      let device = token ? await findDeviceByAuthToken(token) : null;
      if (!device && body.imei) {
        device = await findDeviceByImei(body.imei);
        if (device && device.auth_token_hash && !token) {
          json(res, 401, { error: "Device token required" });
          return true;
        }
      }
      if (!device) {
        json(res, 401, { error: "Unknown or disabled device" });
        return true;
      }
      if (!telematicsUsesDevices(device.telematics_source)) {
        json(res, 403, { error: "Tenant telematics_source does not accept devices" });
        return true;
      }
      const fix = await ingestVehicleFix(device, {
        lat: body.lat ?? body.latitude,
        lon: body.lon ?? body.lng ?? body.longitude,
        recordedAt: body.recordedAt || body.recorded_at || body.utc || body.timestamp,
        speed: body.speed,
        heading: body.heading ?? body.course,
        ignition: body.ignition,
        odometer: body.odometer ?? body.odometerKm,
        altitude: body.altitude ?? body.alt,
        satellites: body.satellites ?? body.sats,
        sourceProtocol: body.protocol || "json",
        rawAttrs: body.attrs || body.rawAttrs || body.attributes || {},
      });
      json(res, 200, { ok: true, fix });
      return true;
    } catch (err) {
      const status = err?.status || (err instanceof SyntaxError ? 400 : 500);
      json(res, status >= 400 && status < 600 ? status : 500, {
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }

  json(res, 404, { error: "Not found" });
  return true;
}
