/**
 * Manager Maintenance PWA API under /api/manager/*
 * Auth: field session cookie + role=manager + mobile.managerMaintenance.
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { fieldFromRequest } from "./field-auth.mjs";
import { mergeEntitlements } from "./entitlements.mjs";
import {
  applyEventPatch,
  loadEventDetail,
  loadPhotoBytes,
  parseDataUrl,
  publicEvent,
  savePhoto,
} from "./maintenance-api.mjs";
import { ensureCatalog } from "./maintenance-catalog.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { tenantByKey } from "./tenants.mjs";

const SELECT_COLS = `id, status, title, notes, armada_user_id, armada_username, user_display_name,
  lat, lon, notification_id, started_at, ended_at, odometer_km,
  service_point_id, service_point_name, service_point_lat, service_point_lon,
  assigned_field_user_id,
  remind_due_at, remind_interval_days, remind_interval_km, remind_baseline_odometer_km,
  remind_interval_hours, remind_hours_since_at,
  remind_before_days, remind_before_km, remind_before_hours, parent_event_id,
  approved_at, approved_by,
  created_at, updated_at`;

const STATUSES = ["due", "in_progress", "done", "skipped", "approved"];

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

function withManagerPhotoUrls(event) {
  if (!event) return event;
  return {
    ...event,
    photos: (event.photos || []).map((p) => ({
      ...p,
      url: `/api/manager/maintenance/photos/${p.id}`,
    })),
  };
}

async function requireManager(req, res) {
  const user = await fieldFromRequest(req);
  if (!user) {
    json(res, 401, { error: "Not logged in" });
    return null;
  }
  if (String(user.role || "") !== "manager") {
    json(res, 403, { error: "Manager role required. Technicians use /m." });
    return null;
  }
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [user.tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  if (ent.mobile?.managerMaintenance !== true) {
    json(res, 403, { error: "Manager Maintenance PWA is disabled for this tenant" });
    return null;
  }
  return user;
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleManagerRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/manager")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    const photoGet = /^\/api\/manager\/maintenance\/photos\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (photoGet && req.method === "GET") {
      const user = await requireManager(req, res);
      if (!user) return true;
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

    if (!url.pathname.startsWith("/api/manager/maintenance")) {
      json(res, 404, { error: "Not found" });
      return true;
    }

    const user = await requireManager(req, res);
    if (!user) return true;

    if (url.pathname === "/api/manager/maintenance/field-users" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT id, username, role, display_name, enabled
         FROM field_users
         WHERE tenant_id = $1 AND role <> 'manager'
         ORDER BY username ASC`,
        [user.tenantId],
      );
      json(res, 200, {
        users: rows.rows.map((r) => ({
          id: r.id,
          username: r.username,
          role: r.role,
          displayName: r.display_name || "",
          enabled: r.enabled !== false,
        })),
      });
      return true;
    }

    if (url.pathname === "/api/manager/maintenance/catalog" && req.method === "GET") {
      const groups = await ensureCatalog(user.tenantId);
      json(res, 200, {
        groups: groups.map((g) => ({
          ...g,
          items: (g.items || []).filter((it) => it.enabled !== false),
        })),
      });
      return true;
    }

    if (url.pathname === "/api/manager/maintenance/events" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "all").toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 150));
      const clauses = ["tenant_id = $1"];
      const params = [user.tenantId];

      if (status === "open") {
        clauses.push("status IN ('due', 'in_progress')");
      } else if (status === "completed" || status === "awaiting") {
        clauses.push("status = 'done'");
      } else if (STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid status filter" });
        return true;
      }

      // Managers need unassigned follow-ups so they can assign.
      params.push(limit);
      const rows = await dbQuery(
        `SELECT ${SELECT_COLS} FROM service_events
         WHERE ${clauses.join(" AND ")}
         ORDER BY
           CASE status
             WHEN 'in_progress' THEN 0
             WHEN 'due' THEN 1
             WHEN 'done' THEN 2
             ELSE 3
           END,
           COALESCE(remind_due_at, created_at) DESC
         LIMIT $${params.length}`,
        params,
      );
      json(res, 200, { events: rows.rows.map((r) => publicEvent(r)) });
      return true;
    }

    const evMatch = /^\/api\/manager\/maintenance\/events\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (evMatch && req.method === "GET") {
      const detail = await loadEventDetail(user.tenantId, evMatch[1]);
      if (!detail) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      json(res, 200, { event: withManagerPhotoUrls(detail) });
      return true;
    }

    if (evMatch && req.method === "PATCH") {
      const found = await dbQuery(
        `SELECT ${SELECT_COLS} FROM service_events WHERE id = $1 AND tenant_id = $2`,
        [evMatch[1], user.tenantId],
      );
      if (!found.rows[0]) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const vaultTenant = tenantByKey(user.tenantKey) || undefined;
      const { event: patched, nextEvent } = await applyEventPatch(found.rows[0], body, user.tenantId, {
        tenantKey: user.tenantKey,
        vaultTenant,
        actor: "manager",
        actorLabel: user.displayName || user.username,
        approvedBy: user.displayName || user.username,
      });
      json(res, 200, {
        event: withManagerPhotoUrls(patched),
        nextEvent: nextEvent || null,
      });
      return true;
    }

    const photoPost = /^\/api\/manager\/maintenance\/events\/([0-9a-f-]{36})\/photos$/i.exec(
      url.pathname,
    );
    if (photoPost && req.method === "POST") {
      const found = await dbQuery(
        `SELECT id, status FROM service_events WHERE id = $1 AND tenant_id = $2`,
        [photoPost[1], user.tenantId],
      );
      if (!found.rows[0]) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      if (found.rows[0].status === "approved") {
        json(res, 403, { error: "Approved jobs are locked and cannot be edited" });
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
      photo.url = `/api/manager/maintenance/photos/${photo.id}`;
      json(res, 201, { photo });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[manager]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
