/**
 * Phase F — Dispatch lite (embed desk).
 * GET    /api/dispatch/jobs?status=&limit=
 * POST   /api/dispatch/jobs
 * GET    /api/dispatch/jobs/:id
 * PATCH  /api/dispatch/jobs/:id
 * GET    /api/dispatch/field-users
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import { mergeEntitlements, moduleEnabled } from "./entitlements.mjs";
import { resolveDbTenant } from "./maintenance-api.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

const STATUSES = ["draft", "assigned", "en_route", "arrived", "done", "cancelled"];
const STOP_STATUSES = ["pending", "arrived", "done", "skipped"];

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

function readBody(req, limit = 512_000) {
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

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function publicStop(row) {
  return {
    id: row.id,
    sortOrder: Number(row.sort_order) || 0,
    name: row.name || "",
    address: row.address || "",
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    notes: row.notes || "",
    status: row.status || "pending",
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
  };
}

function publicJob(row, stops = []) {
  return {
    id: row.id,
    status: row.status,
    title: row.title || "",
    notes: row.notes || "",
    armadaUserId: row.armada_user_id == null ? null : Number(row.armada_user_id),
    armadaUsername: row.armada_username || "",
    userDisplayName: row.user_display_name || "",
    assignedFieldUserId: row.assigned_field_user_id || null,
    assigneeUsername: row.assignee_username || "",
    assigneeDisplayName: row.assignee_display_name || "",
    assignedAt: row.assigned_at || null,
    startedAt: row.started_at || null,
    arrivedAt: row.arrived_at || null,
    completedAt: row.completed_at || null,
    fieldNote: row.field_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stops: stops.map(publicStop),
  };
}

async function loadStops(jobId) {
  const rows = await dbQuery(
    `SELECT id, sort_order, name, address, lat, lon, notes, status, arrived_at, completed_at
     FROM dispatch_stops WHERE job_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [jobId],
  );
  return rows.rows;
}

async function loadJob(tenantId, jobId) {
  const found = await dbQuery(
    `SELECT j.*,
            u.username AS assignee_username,
            u.display_name AS assignee_display_name
     FROM dispatch_jobs j
     LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
     WHERE j.id = $1 AND j.tenant_id = $2`,
    [jobId, tenantId],
  );
  return found.rows[0] || null;
}

async function requireDispatchModule(tenantId) {
  const row = await dbQuery(`SELECT entitlements FROM tenants WHERE id = $1`, [tenantId]);
  const ent = mergeEntitlements(row.rows[0]?.entitlements);
  return moduleEnabled(ent, "dispatch");
}

function normalizeStops(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (let i = 0; i < raw.length && out.length < 50; i++) {
    const s = raw[i];
    if (!s || typeof s !== "object") continue;
    const lat = s.lat == null || s.lat === "" ? null : Number(s.lat);
    const lon = s.lon == null || s.lon === "" ? null : Number(s.lon ?? s.lng);
    out.push({
      name: String(s.name || s.label || `Stop ${i + 1}`).trim().slice(0, 200) || `Stop ${i + 1}`,
      address: String(s.address || "").trim().slice(0, 500) || null,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      notes: String(s.notes || "").trim().slice(0, 1000) || null,
      sortOrder: Number.isInteger(Number(s.sortOrder)) ? Number(s.sortOrder) : i,
    });
  }
  return out;
}

async function replaceStops(jobId, stops) {
  await dbQuery(`DELETE FROM dispatch_stops WHERE job_id = $1`, [jobId]);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    await dbQuery(
      `INSERT INTO dispatch_stops (job_id, sort_order, name, address, lat, lon, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [jobId, s.sortOrder ?? i, s.name, s.address, s.lat, s.lon, s.notes],
    );
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleDispatchRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/dispatch")) return false;

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
    if (!(await requireDispatchModule(dbTenant.id))) {
      json(res, 403, { error: "Dispatch module not enabled for this tenant" });
      return true;
    }

    if (url.pathname === "/api/dispatch/field-users" && req.method === "GET") {
      const rows = await dbQuery(
        `SELECT id, username, role, display_name, enabled
         FROM field_users
         WHERE tenant_id = $1 AND enabled = true
         ORDER BY lower(coalesce(nullif(display_name,''), username)) ASC
         LIMIT 200`,
        [dbTenant.id],
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

    if (url.pathname === "/api/dispatch/jobs" && req.method === "GET") {
      const status = String(url.searchParams.get("status") || "open").toLowerCase();
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      const clauses = ["j.tenant_id = $1"];
      const params = [dbTenant.id];
      if (status === "open") {
        clauses.push(`j.status IN ('draft','assigned','en_route','arrived')`);
      } else if (STATUSES.includes(status)) {
        params.push(status);
        clauses.push(`j.status = $${params.length}`);
      } else if (status !== "all") {
        json(res, 400, { error: "Invalid status filter" });
        return true;
      }
      params.push(limit);
      const rows = await dbQuery(
        `SELECT j.*,
                u.username AS assignee_username,
                u.display_name AS assignee_display_name
         FROM dispatch_jobs j
         LEFT JOIN field_users u ON u.id = j.assigned_field_user_id
         WHERE ${clauses.join(" AND ")}
         ORDER BY j.updated_at DESC
         LIMIT $${params.length}`,
        params,
      );
      const jobs = [];
      for (const row of rows.rows) {
        const stops = await loadStops(row.id);
        jobs.push(publicJob(row, stops));
      }
      json(res, 200, { jobs });
      return true;
    }

    if (url.pathname === "/api/dispatch/jobs" && req.method === "POST") {
      const body = await readJson(req);
      const title = String(body.title || "").trim().slice(0, 200);
      if (!title) {
        json(res, 400, { error: "title is required" });
        return true;
      }
      const notes = String(body.notes || "").trim().slice(0, 4000) || null;
      const armadaUserId =
        body.armadaUserId == null || body.armadaUserId === ""
          ? null
          : Number.isInteger(Number(body.armadaUserId)) && Number(body.armadaUserId) > 0
            ? Number(body.armadaUserId)
            : null;
      const armadaUsername = String(body.armadaUsername || "").trim().slice(0, 120) || null;
      const userDisplayName = String(body.userDisplayName || "").trim().slice(0, 200) || null;
      let assigneeId = body.assignedFieldUserId || null;
      if (assigneeId) {
        const ok = await dbQuery(
          `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
          [assigneeId, dbTenant.id],
        );
        if (!ok.rows[0]) {
          json(res, 400, { error: "assignedFieldUserId not found" });
          return true;
        }
      }
      let status = String(body.status || (assigneeId ? "assigned" : "draft")).toLowerCase();
      if (!STATUSES.includes(status)) status = assigneeId ? "assigned" : "draft";
      if (assigneeId && status === "draft") status = "assigned";

      const inserted = await dbQuery(
        `INSERT INTO dispatch_jobs (
           tenant_id, status, title, notes,
           armada_user_id, armada_username, user_display_name,
           assigned_field_user_id, assigned_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $8::uuid IS NULL THEN NULL ELSE now() END)
         RETURNING id`,
        [
          dbTenant.id,
          status,
          title,
          notes,
          armadaUserId,
          armadaUsername,
          userDisplayName,
          assigneeId,
        ],
      );
      const jobId = inserted.rows[0].id;
      await replaceStops(jobId, normalizeStops(body.stops));
      const row = await loadJob(dbTenant.id, jobId);
      const stops = await loadStops(jobId);
      json(res, 201, { job: publicJob(row, stops) });
      return true;
    }

    const one = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (one && req.method === "GET") {
      const row = await loadJob(dbTenant.id, one[1]);
      if (!row) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      json(res, 200, { job: publicJob(row, await loadStops(row.id)) });
      return true;
    }

    if (one && req.method === "PATCH") {
      const existing = await loadJob(dbTenant.id, one[1]);
      if (!existing) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const sets = [];
      const params = [];

      if ("title" in body) {
        const title = String(body.title || "").trim().slice(0, 200);
        if (!title) {
          json(res, 400, { error: "title cannot be empty" });
          return true;
        }
        params.push(title);
        sets.push(`title = $${params.length}`);
      }
      if ("notes" in body) {
        params.push(String(body.notes || "").trim().slice(0, 4000) || null);
        sets.push(`notes = $${params.length}`);
      }
      if ("armadaUserId" in body) {
        const n = body.armadaUserId;
        params.push(
          n == null || n === ""
            ? null
            : Number.isInteger(Number(n)) && Number(n) > 0
              ? Number(n)
              : null,
        );
        sets.push(`armada_user_id = $${params.length}`);
      }
      if ("armadaUsername" in body) {
        params.push(String(body.armadaUsername || "").trim().slice(0, 120) || null);
        sets.push(`armada_username = $${params.length}`);
      }
      if ("userDisplayName" in body) {
        params.push(String(body.userDisplayName || "").trim().slice(0, 200) || null);
        sets.push(`user_display_name = $${params.length}`);
      }
      if ("assignedFieldUserId" in body) {
        let assigneeId = body.assignedFieldUserId || null;
        if (assigneeId) {
          const ok = await dbQuery(
            `SELECT id FROM field_users WHERE id = $1 AND tenant_id = $2 AND enabled = true`,
            [assigneeId, dbTenant.id],
          );
          if (!ok.rows[0]) {
            json(res, 400, { error: "assignedFieldUserId not found" });
            return true;
          }
        }
        params.push(assigneeId);
        sets.push(`assigned_field_user_id = $${params.length}`);
        if (assigneeId) {
          sets.push(`assigned_at = COALESCE(assigned_at, now())`);
          if (!("status" in body) && existing.status === "draft") {
            sets.push(`status = 'assigned'`);
          }
        } else {
          sets.push(`assigned_at = NULL`);
        }
      }
      if ("status" in body) {
        const status = String(body.status || "").toLowerCase();
        if (!STATUSES.includes(status)) {
          json(res, 400, { error: "Invalid status" });
          return true;
        }
        params.push(status);
        sets.push(`status = $${params.length}`);
        if (status === "en_route") sets.push(`started_at = COALESCE(started_at, now())`);
        if (status === "arrived") sets.push(`arrived_at = COALESCE(arrived_at, now())`);
        if (status === "done" || status === "cancelled") {
          sets.push(`completed_at = COALESCE(completed_at, now())`);
        }
      }
      if ("fieldNote" in body) {
        params.push(String(body.fieldNote || "").trim().slice(0, 2000) || null);
        sets.push(`field_note = $${params.length}`);
      }
      if ("stops" in body) {
        await replaceStops(existing.id, normalizeStops(body.stops));
      }

      if (sets.length) {
        sets.push(`updated_at = now()`);
        params.push(existing.id, dbTenant.id);
        await dbQuery(
          `UPDATE dispatch_jobs SET ${sets.join(", ")}
           WHERE id = $${params.length - 1} AND tenant_id = $${params.length}`,
          params,
        );
      }

      const row = await loadJob(dbTenant.id, existing.id);
      json(res, 200, { job: publicJob(row, await loadStops(row.id)) });
      return true;
    }

    // Optional: patch a single stop status from desk
    const stopPatch = /^\/api\/dispatch\/jobs\/([0-9a-f-]{36})\/stops\/([0-9a-f-]{36})$/i.exec(
      url.pathname,
    );
    if (stopPatch && req.method === "PATCH") {
      const job = await loadJob(dbTenant.id, stopPatch[1]);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return true;
      }
      const body = await readJson(req);
      const status = String(body.status || "").toLowerCase();
      if (!STOP_STATUSES.includes(status)) {
        json(res, 400, { error: "Invalid stop status" });
        return true;
      }
      const updated = await dbQuery(
        `UPDATE dispatch_stops s
         SET status = $1,
             arrived_at = CASE WHEN $1 = 'arrived' THEN COALESCE(arrived_at, now()) ELSE arrived_at END,
             completed_at = CASE WHEN $1 IN ('done','skipped') THEN COALESCE(completed_at, now()) ELSE completed_at END
         FROM dispatch_jobs j
         WHERE s.id = $2 AND s.job_id = j.id AND j.id = $3 AND j.tenant_id = $4
         RETURNING s.*`,
        [status, stopPatch[2], stopPatch[1], dbTenant.id],
      );
      if (!updated.rows[0]) {
        json(res, 404, { error: "Stop not found" });
        return true;
      }
      json(res, 200, {
        stop: publicStop(updated.rows[0]),
        job: publicJob(await loadJob(dbTenant.id, job.id), await loadStops(job.id)),
      });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dispatch]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
