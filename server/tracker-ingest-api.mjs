/**
 * HTTP/JSON GPS ingest for trackers and lab tools.
 *
 *   POST /api/tracker/ingest/v1/fix
 *   Authorization: Bearer <device-auth-token>
 *   Body: { lat, lon, recordedAt?, speed?, heading?, ignition?, odometer?, altitude?, satellites?, imei?, attrs? }
 *
 * Also accepts X-Device-Token header.
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { mergeEntitlements } from "./entitlements.mjs";
import { fieldFromRequest } from "./field-auth.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
import {
  findDeviceByAuthToken,
  findDeviceByImei,
  ingestVehicleFix,
  listDeviceDayFixes,
  listTenantLastFixes,
  telematicsUsesDevices,
  tenantFleetLiveDisplayPinMeta,
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

/** Desk session optional: unsigned embed/tenant-key OK; signed-in users need the privilege. */
async function requireDeskPrivilege(req, res, tenantId, privilege) {
  const user = await fieldFromRequest(req);
  if (!user) return true;
  if (String(user.tenantId) !== String(tenantId)) {
    json(res, 403, { error: "Signed-in user does not match this tenant" });
    return false;
  }
  if (!user.privileges || user.privileges[privilege] !== true) {
    json(res, 403, { error: `Missing desk privilege: ${privilege}` });
    return false;
  }
  return true;
}

/** Feature flags default on; only block when explicitly false. */
async function requireFleetFeature(res, tenantId, featureKey) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  if (ent.features?.[featureKey] === false) {
    json(res, 403, { error: `Feature disabled: ${featureKey}` });
    return false;
  }
  return true;
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
      const { displayPinIds, displayPinLabels } = await tenantFleetLiveDisplayPinMeta(dbTenant.id);
      if (!telematicsUsesDevices(source)) {
        json(res, 200, {
          fixes: [],
          telematicsSource: source,
          displayPinIds,
          displayPinLabels,
        });
        return true;
      }
      const groupIds = [
        ...url.searchParams.getAll("groupId"),
        ...String(url.searchParams.get("groupIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ];
      const fixes = await listTenantLastFixes(dbTenant.id, { groupIds, displayPinIds });
      json(res, 200, {
        fixes,
        telematicsSource: source,
        displayPinIds,
        displayPinLabels,
      });
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
      const includeMembers =
        url.searchParams.get("members") === "1" ||
        url.searchParams.get("includeMembers") === "1";
      const groups = await listDeviceGroups(dbTenant.id, { includeMembers });
      json(res, 200, { groups });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  /** Resolve tracker device group(s) → device ids + linked Armada user ids (for Dispatch/Maintenance filters). */
  if (url.pathname === "/api/tracker/param-values" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const deviceId = String(url.searchParams.get("deviceId") || "").trim();
      if (!deviceId) {
        json(res, 400, { error: "deviceId required" });
        return true;
      }
      const includeRaw =
        url.searchParams.get("raw") === "1" || url.searchParams.get("includeRaw") === "1";
      const { listDeviceParamValues } = await import("./device-manager.mjs");
      const data = await listDeviceParamValues(dbTenant.id, { deviceId, includeRaw });
      json(res, 200, data);
      return true;
    } catch (err) {
      json(res, err.status || 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/fix-params" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const deviceId = String(url.searchParams.get("deviceId") || "").trim();
      const recordedAt = String(url.searchParams.get("recordedAt") || "").trim();
      const includeRaw =
        url.searchParams.get("raw") === "1" || url.searchParams.get("includeRaw") === "1";
      const { listFixParamValues } = await import("./device-manager.mjs");
      const data = await listFixParamValues(dbTenant.id, { deviceId, recordedAt, includeRaw });
      json(res, 200, data);
      return true;
    } catch (err) {
      json(res, err.status || 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/device-group-scope" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const groupIds = [
        ...url.searchParams.getAll("groupId"),
        ...url.searchParams.getAll("deviceGroupId"),
        ...String(url.searchParams.get("groupIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
      if (!groupIds.length) {
        json(res, 400, { error: "groupId required" });
        return true;
      }
      const { deviceIdsInGroups } = await import("./tracker-device-groups.mjs");
      const { armadaUserIdsInDeviceGroups } = await import("./tracker-devices.mjs");
      const deviceIds = await deviceIdsInGroups(dbTenant.id, groupIds);
      const armadaUserIds = await armadaUserIdsInDeviceGroups(dbTenant.id, groupIds);
      json(res, 200, {
        groupIds,
        deviceIds,
        armadaUserIds,
        memberCount: deviceIds.length,
        linkedArmadaCount: armadaUserIds.length,
      });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/device-day" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const source = await tenantTelematicsSource(dbTenant.id);
      if (!telematicsUsesDevices(source)) {
        json(res, 200, {
          deviceId: "",
          date: "",
          points: [],
          telematicsSource: source,
        });
        return true;
      }
      const deviceId = String(url.searchParams.get("deviceId") || "").trim();
      const date = String(url.searchParams.get("date") || "").trim().slice(0, 10);
      const tzOffset = String(url.searchParams.get("tz") || url.searchParams.get("tzOffset") || "").trim();
      if (!deviceId || !date) {
        json(res, 400, { error: "deviceId and date (YYYY-MM-DD) required" });
        return true;
      }
      const day = await listDeviceDayFixes(dbTenant.id, deviceId, { date, tzOffset });
      if (day.error) {
        json(res, 404, { error: day.error });
        return true;
      }
      json(res, 200, { ...day, telematicsSource: source });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (
    (url.pathname === "/api/tracker/safety-events" || url.pathname === "/api/tracker/media") &&
    req.method === "GET"
  ) {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const { listSafetyEvents } = await import("./device-manager.mjs");
      const { dbQuery } = await import("./db.mjs");
      const isMedia = url.pathname === "/api/tracker/media";
      const limit = Math.min(
        isMedia ? 200 : 100,
        Math.max(1, Number(url.searchParams.get("limit")) || (isMedia ? 80 : 40)),
      );
      const deviceId = String(url.searchParams.get("deviceId") || "").trim() || undefined;
      const groupIds = [
        ...url.searchParams.getAll("groupId"),
        ...String(url.searchParams.get("groupIds") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ];
      const from = String(url.searchParams.get("from") || "").trim() || undefined;
      const to = String(url.searchParams.get("to") || "").trim() || undefined;
      const kindFilter = String(url.searchParams.get("kind") || "all")
        .trim()
        .toLowerCase();
      let events = await listSafetyEvents(dbTenant.id, {
        deviceId,
        groupIds,
        from,
        to,
        mediaOnly: isMedia || url.searchParams.get("mediaOnly") === "1",
        limit: isMedia ? Math.min(500, limit * 3) : limit,
      });
      if (isMedia && kindFilter && kindFilter !== "all") {
        events = events.filter((e) => e.mediaKind === kindFilter);
      }
      if (isMedia) events = events.slice(0, limit);

      const ids = [...new Set(events.map((e) => e.deviceId).filter(Boolean))];
      /** @type {Map<string, { label: string, imei: string, protocol: string }>} */
      const byDevice = new Map();
      if (ids.length) {
        const rows = await dbQuery(
          `SELECT id, label, imei, protocol FROM tracker_devices WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [dbTenant.id, ids],
        );
        for (const r of rows.rows) {
          byDevice.set(r.id, {
            label: r.label || r.imei,
            imei: r.imei,
            protocol: r.protocol || "",
          });
        }
      }

      let mediaCapableCount = 0;
      if (isMedia) {
        const cap = await dbQuery(
          `SELECT COUNT(*)::int AS n FROM tracker_devices
           WHERE tenant_id = $1 AND enabled = true
             AND protocol = ANY($2::text[])`,
          [dbTenant.id, ["jt808", "subiao", "jt1078", "jt809", "video"]],
        );
        mediaCapableCount = Number(cap.rows[0]?.n) || 0;
      }

      json(res, 200, {
        events: events.map((e) => {
          const d = byDevice.get(e.deviceId);
          const mapped =
            e.mappedAttrs && typeof e.mappedAttrs === "object" ? e.mappedAttrs : {};
          return {
            ...e,
            deviceLabel: d?.label || "",
            imei: d?.imei || "",
            protocol: d?.protocol || e.sourceProtocol || "",
            mediaChannel: mapped.media_channel ?? mapped.mediaChannel ?? null,
            mediaId: mapped.media_id ?? mapped.mediaId ?? null,
          };
        }),
        ...(isMedia ? { mediaCapableCount } : {}),
      });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/alert-rules" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      if (!(await requireFleetFeature(res, dbTenant.id, "fleetLiveRules"))) return true;
      const { listFleetAlertRules } = await import("./fleet-alert-rules.mjs");
      json(res, 200, { rules: await listFleetAlertRules(dbTenant.id) });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/alert-rules" && req.method === "POST") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      if (!(await requireFleetFeature(res, dbTenant.id, "fleetLiveRules"))) return true;
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageFleetRules"))) return true;
      const raw = await readBody(req);
      const body = raw.trim() ? JSON.parse(raw) : {};
      const { createFleetAlertRule } = await import("./fleet-alert-rules.mjs");
      const rule = await createFleetAlertRule(dbTenant.id, body);
      json(res, 201, { rule });
      return true;
    } catch (err) {
      json(res, err.status || 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  const ruleMatch = /^\/api\/tracker\/alert-rules\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if (ruleMatch && (req.method === "PUT" || req.method === "PATCH")) {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      if (!(await requireFleetFeature(res, dbTenant.id, "fleetLiveRules"))) return true;
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageFleetRules"))) return true;
      const raw = await readBody(req);
      const body = raw.trim() ? JSON.parse(raw) : {};
      const { updateFleetAlertRule } = await import("./fleet-alert-rules.mjs");
      const rule = await updateFleetAlertRule(dbTenant.id, ruleMatch[1], body);
      json(res, 200, { rule });
      return true;
    } catch (err) {
      json(res, err.status || 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }
  if (ruleMatch && req.method === "DELETE") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      if (!(await requireFleetFeature(res, dbTenant.id, "fleetLiveRules"))) return true;
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "manageFleetRules"))) return true;
      const { deleteFleetAlertRule } = await import("./fleet-alert-rules.mjs");
      const ok = await deleteFleetAlertRule(dbTenant.id, ruleMatch[1]);
      if (!ok) {
        json(res, 404, { error: "Rule not found" });
        return true;
      }
      json(res, 200, { ok: true });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/alert-holds" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const { listFleetAlertRuleHolds } = await import("./fleet-alert-rules.mjs");
      const limit = Number(url.searchParams.get("limit")) || 40;
      json(res, 200, { holds: await listFleetAlertRuleHolds(dbTenant.id, { limit }) });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  if (url.pathname === "/api/tracker/alert-events" && req.method === "GET") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      const { listFleetAlertEvents } = await import("./fleet-alert-rules.mjs");
      const status = String(url.searchParams.get("status") || "").trim() || undefined;
      const limit = Number(url.searchParams.get("limit")) || 80;
      json(res, 200, { events: await listFleetAlertEvents(dbTenant.id, { status, limit }) });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  const ackMatch = /^\/api\/tracker\/alert-events\/([0-9a-f-]{36})\/ack$/i.exec(url.pathname);
  if (ackMatch && req.method === "POST") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "ackFleetAlerts"))) return true;
      const { ackFleetAlertEvent } = await import("./fleet-alert-rules.mjs");
      const ok = await ackFleetAlertEvent(dbTenant.id, ackMatch[1]);
      json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Event not found" });
      return true;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  const resolveMatch = /^\/api\/tracker\/alert-events\/([0-9a-f-]{36})\/resolve$/i.exec(url.pathname);
  if (resolveMatch && req.method === "POST") {
    try {
      const dbTenant = await resolveDbTenant(req);
      if (!dbTenant) {
        json(res, 401, { error: "Tenant key required (k=)" });
        return true;
      }
      if (!(await requireDeskPrivilege(req, res, dbTenant.id, "ackFleetAlerts"))) return true;
      const { resolveFleetAlertEvent } = await import("./fleet-alert-rules.mjs");
      const ok = await resolveFleetAlertEvent(dbTenant.id, resolveMatch[1]);
      json(res, ok ? 200 : 404, ok ? { ok: true } : { error: "Event not found" });
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
