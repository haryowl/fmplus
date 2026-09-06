/**
 * Field-user login API under /api/field/*
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import {
  clearFieldSessionCookieHeader,
  createFieldSession,
  destroyFieldSessionByToken,
  fieldCookieName,
  fieldFromRequest,
  fieldSessionCookieHeader,
  verifyPassword,
} from "./field-auth.mjs";
import { readCookies } from "./admin-auth.mjs";
import { applyEventPatch, loadEventDetail, loadPhotoBytes, parseDataUrl, publicEvent, savePhoto } from "./maintenance-api.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { mergeEntitlements } from "./entitlements.mjs";

const SELECT_COLS = `id, status, title, notes, armada_user_id, armada_username, user_display_name,
  lat, lon, notification_id, started_at, ended_at, odometer_km,
  service_point_id, service_point_name, service_point_lat, service_point_lon,
  assigned_field_user_id,
  remind_due_at, remind_interval_days, remind_interval_km, remind_baseline_odometer_km,
  remind_interval_hours, remind_hours_since_at,
  remind_before_days, remind_before_km, remind_before_hours, parent_event_id,
  approved_at, approved_by,
  created_at, updated_at`;

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, obj, extraHeaders = {}) {
  send(
    res,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    JSON.stringify(obj),
  );
}

/** @param {import('node:http').IncomingMessage} req */
function readBody(req, limit = 20_000_000) {
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
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  const text = raw.toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function publicFieldUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName || user.display_name || "",
    tenantKey: user.tenantKey || user.tenant_key,
    appId: user.appId ?? user.app_id,
    tenantId: user.tenantId || user.tenant_id,
  };
}

/** Open/closed jobs strictly assigned to this field user (same tenant). */
async function loadAssignedEventRow(tenantId, eventId, fieldUserId) {
  const found = await dbQuery(
    `SELECT ${SELECT_COLS} FROM service_events
     WHERE id = $1 AND tenant_id = $2 AND assigned_field_user_id = $3`,
    [eventId, tenantId, fieldUserId],
  );
  return found.rows[0] || null;
}

async function tenantMobileMaintenanceEnabled(tenantId) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  return ent.mobile?.maintenance === true;
}

export async function handleFieldRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/field")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    if (url.pathname === "/api/field/login" && req.method === "POST") {
      const body = await readJson(req);
      const tenantKey = String(body.tenantKey || body.k || "").trim();
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!tenantKey || !username || !password) {
        json(res, 400, { error: "tenantKey, username, and password are required" });
        return true;
      }
      const found = await dbQuery(
        `SELECT u.id, u.username, u.password_hash, u.role, u.display_name, u.enabled,
                t.id AS tenant_id, t.key AS tenant_key, t.app_id, t.enabled AS tenant_enabled
         FROM field_users u
         JOIN tenants t ON t.id = u.tenant_id
         WHERE t.key = $1 AND u.username = $2`,
        [tenantKey, username],
      );
      const row = found.rows[0];
      if (
        !row ||
        row.enabled === false ||
        row.tenant_enabled === false ||
        !verifyPassword(password, row.password_hash)
      ) {
        json(res, 401, { error: "Invalid credentials" });
        return true;
      }
      const session = await createFieldSession(row.id);
      const maxAge = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
      const mobileOk = await tenantMobileMaintenanceEnabled(row.tenant_id);
      json(
        res,
        200,
        {
          ok: true,
          user: publicFieldUser({
            id: row.id,
            username: row.username,
            role: row.role,
            displayName: row.display_name,
            tenantKey: row.tenant_key,
            tenantId: row.tenant_id,
            appId: Number(row.app_id),
          }),
          mobileMaintenance: mobileOk,
        },
        { "Set-Cookie": fieldSessionCookieHeader(session.token, maxAge) },
      );
      return true;
    }

    if (url.pathname === "/api/field/logout" && req.method === "POST") {
      const token = readCookies(req)[fieldCookieName()];
      if (token) await destroyFieldSessionByToken(token);
      json(res, 200, { ok: true }, { "Set-Cookie": clearFieldSessionCookieHeader() });
      return true;
    }

    if (url.pathname === "/api/field/me" && req.method === "GET") {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      const mobileOk = await tenantMobileMaintenanceEnabled(user.tenantId);
      json(res, 200, { user: publicFieldUser(user), mobileMaintenance: mobileOk });
      return true;
    }

    const photoGet = /^\/api\/field\/maintenance\/photos\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (photoGet && req.method === "GET") {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      const found = await dbQuery(
        `SELECT p.id
         FROM service_event_photos p
         JOIN service_events e ON e.id = p.event_id
         WHERE p.id = $1 AND e.tenant_id = $2 AND e.assigned_field_user_id = $3`,
        [photoGet[1], user.tenantId, user.id],
      );
      if (!found.rows[0]) {
        json(res, 404, { error: "Photo not found" });
        return true;
      }
      const obj = await loadPhotoBytes(photoGet[1], user.tenantId);
      if (!obj) {
        json(res, 404, { error: "Photo not found" });
        return true;
      }
      send(
        res,
        200,
        {
          "Content-Type": obj.contentType || "image/jpeg",
          "Cache-Control": "private, max-age=3600",
        },
        obj.body,
      );
      return true;
    }

    if (url.pathname.startsWith("/api/field/maintenance")) {
      const user = await fieldFromRequest(req);
      if (!user) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      if (!(await tenantMobileMaintenanceEnabled(user.tenantId))) {
        json(res, 403, { error: "Maintenance PWA is disabled for this tenant" });
        return true;
      }

      if (url.pathname === "/api/field/maintenance/events" && req.method === "GET") {
        const rows = await dbQuery(
          `SELECT ${SELECT_COLS} FROM service_events
           WHERE tenant_id = $1
             AND status IN ('due', 'in_progress')
             AND assigned_field_user_id = $2
           ORDER BY created_at DESC
           LIMIT 100`,
          [user.tenantId, user.id],
        );
        json(res, 200, { events: rows.rows.map((r) => publicEvent(r)) });
        return true;
      }

      if (url.pathname === "/api/field/maintenance/catalog" && req.method === "GET") {
        const { ensureCatalog } = await import("./maintenance-catalog.mjs");
        const groups = await ensureCatalog(user.tenantId);
        json(res, 200, {
          groups: groups.map((g) => ({
            ...g,
            items: (g.items || []).filter((it) => it.enabled !== false),
          })),
        });
        return true;
      }

      const evMatch = /^\/api\/field\/maintenance\/events\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (evMatch && req.method === "GET") {
        const row = await loadAssignedEventRow(user.tenantId, evMatch[1], user.id);
        if (!row) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        const detail = await loadEventDetail(user.tenantId, evMatch[1]);
        if (!detail || detail.assignedFieldUserId !== user.id) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        detail.photos = (detail.photos || []).map((p) => ({
          ...p,
          url: `/api/field/maintenance/photos/${p.id}`,
        }));
        json(res, 200, { event: detail });
        return true;
      }

      if (evMatch && req.method === "PATCH") {
        const found = await loadAssignedEventRow(user.tenantId, evMatch[1], user.id);
        if (!found) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        const body = await readJson(req);
        delete body.assignedFieldUserId;
        const { event: patched, nextEvent } = await applyEventPatch(found, body, user.tenantId, {
          tenantKey: user.tenantKey,
          actor: "field",
        });
        const event = {
          ...patched,
          photos: (patched.photos || []).map((p) => ({
            ...p,
            url: `/api/field/maintenance/photos/${p.id}`,
          })),
        };
        json(res, 200, { event, nextEvent: nextEvent || null });
        return true;
      }

      const photoPost = /^\/api\/field\/maintenance\/events\/([0-9a-f-]{36})\/photos$/i.exec(url.pathname);
      if (photoPost && req.method === "POST") {
        const found = await loadAssignedEventRow(user.tenantId, photoPost[1], user.id);
        if (!found) {
          json(res, 404, { error: "Job not found or not assigned to you" });
          return true;
        }
        if (found.status === "done" || found.status === "skipped" || found.status === "approved") {
          json(res, 403, { error: "Completed jobs can only be edited by a manager" });
          return true;
        }
        const body = await readJson(req);
        const parsed = parseDataUrl(body.dataUrl || body.data || "");
        if (!parsed) {
          json(res, 400, { error: "dataUrl (base64 data URI) required" });
          return true;
        }
        if (parsed.buffer.length < 32 || parsed.buffer.length > 12_000_000) {
          json(res, 400, { error: "Image must be between 32B and 12MB" });
          return true;
        }
        const photo = await savePhoto(photoPost[1], user.tenantId, {
          buffer: parsed.buffer,
          contentType: parsed.contentType,
          caption: String(body.caption || "").trim(),
          fieldUserId: user.id,
        });
        photo.url = `/api/field/maintenance/photos/${photo.id}`;
        json(res, 201, { photo });
        return true;
      }

      json(res, 404, { error: "Not found" });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[field]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
