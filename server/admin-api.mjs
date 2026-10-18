/**
 * Admin control-plane HTTP API under /api/admin/*
 */
import { databaseUrlConfigured, dbQuery } from "./db.mjs";
import {
  adminCookieName,
  adminFromRequest,
  clearSessionCookieHeader,
  createSession,
  destroySessionByToken,
  maybeBootstrapAdmin,
  readCookies,
  sessionCookieHeader,
  verifyPassword,
  writeAudit,
} from "./admin-auth.mjs";
import { encryptSecret, hashWebhookSecret, secretsKeyConfigured } from "./crypto-secrets.mjs";
import { defaultEntitlements, mergeEntitlements } from "./entitlements.mjs";
import { dutyLocationFromTenantRow, normalizeDutyLocationPolicy } from "./duty-location-policy.mjs";
import {
  FIELD_ROLES,
  hashPassword,
  isFieldRole,
  isFieldUsername,
} from "./field-auth.mjs";
import { mergeDeskPrivileges, normalizeDeskPrivilegesInput } from "./desk-privileges.mjs";
import { initTenantVault, isTenantKey } from "./tenants.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import {
  claimUnassignedTrackerImei,
  createTrackerDevice,
  deleteTrackerDevice,
  dismissUnassignedTrackerImei,
  listTrackerDevices,
  listUnassignedTrackerImeis,
  normalizeTelematicsSource,
  updateTrackerDevice,
} from "./tracker-devices.mjs";
import {
  cancelCommand,
  cloneProfile,
  createParamDef,
  createProfile,
  deleteMapRule,
  deleteParamDef,
  deleteProfile,
  enqueueCommand,
  lastFixPreview,
  listCommands,
  listMapRules,
  listParamDefs,
  listProfiles,
  listProtocolParams,
  listSafetyEvents,
  listTerminalEvents,
  previewRemap,
  updateParamDef,
  updateProfile,
  upsertMapRule,
} from "./device-manager.mjs";

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
function readBody(req, limit = 256_000) {
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

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || "https://<fmplus-host>").replace(/\/+$/, "");
}

function publicTenantRow(row) {
  const base = publicBaseUrl();
  const k = encodeURIComponent(row.key);
  return {
    id: row.id,
    key: row.key,
    appId: Number(row.app_id),
    displayName: row.display_name || "",
    enabled: row.enabled !== false,
    userIds: Array.isArray(row.user_ids) ? row.user_ids.map(Number) : [],
    groupIds: Array.isArray(row.group_ids) ? row.group_ids.map(Number) : [],
    entitlements: mergeEntitlements(row.entitlements),
    hasWebhookSecret: Boolean(row.webhook_secret_hash),
    hasToken: Boolean(row.token_ciphertext),
    notifyEmails: row.notify_emails || "",
    notifyWhatsapp: row.notify_whatsapp || "",
    wablasBaseUrl: row.wablas_base_url || "",
    hasWablasToken: Boolean(row.wablas_token_ciphertext),
    hasWablasSecret: Boolean(row.wablas_secret_ciphertext),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notifierUrlTemplate: `${base}/api/armada/notify?k=${k}&secret=<webhook-secret>&kind=exception`,
    notifierUrlMaintenance: `${base}/api/armada/notify?k=${k}&secret=<webhook-secret>&kind=maintenance`,
    dutyLocation: dutyLocationFromTenantRow(row),
    telematicsSource: normalizeTelematicsSource(row.telematics_source),
    trackerIngestUrl: `${base}/api/tracker/ingest/v1/fix`,
  };
}

function publicFieldUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name || "",
    phone: row.phone || "",
    email: row.email || "",
    enabled: row.enabled !== false,
    privileges: mergeDeskPrivileges(row.privileges),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireAdmin(req, res) {
  const admin = await adminFromRequest(req);
  if (!admin) {
    json(res, 401, { error: "Admin login required" });
    return null;
  }
  return admin;
}

export async function handleAdminRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/admin")) return false;

  if (!databaseUrlConfigured()) {
    json(res, 503, { error: "DATABASE_URL is not configured" });
    return true;
  }

  try {
    await maybeBootstrapAdmin();
  } catch (err) {
    console.warn("[admin] bootstrap:", err instanceof Error ? err.message : err);
  }

  const path = url.pathname;

  try {
    if (path === "/api/admin/health" && req.method === "GET") {
      json(res, 200, {
        ok: true,
        secretsKey: secretsKeyConfigured(),
        database: true,
      });
      return true;
    }

    if (path === "/api/admin/login" && req.method === "POST") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!username || !password) {
        json(res, 400, { error: "Username and password required" });
        return true;
      }
      const found = await dbQuery(
        `SELECT id, username, password_hash, enabled FROM admin_users WHERE username = $1`,
        [username],
      );
      const row = found.rows[0];
      if (!row || row.enabled === false || !verifyPassword(password, row.password_hash)) {
        json(res, 401, { error: "Invalid credentials" });
        return true;
      }
      const session = await createSession(row.id);
      await writeAudit(row.id, "admin.login", { username: row.username });
      const maxAge = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
      json(
        res,
        200,
        { ok: true, username: row.username },
        { "Set-Cookie": sessionCookieHeader(session.token, maxAge) },
      );
      return true;
    }

    if (path === "/api/admin/logout" && req.method === "POST") {
      const token = readCookies(req)[adminCookieName()];
      const admin = await adminFromRequest(req);
      if (token) await destroySessionByToken(token);
      if (admin) await writeAudit(admin.id, "admin.logout", {});
      json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookieHeader() });
      return true;
    }

    if (path === "/api/admin/me" && req.method === "GET") {
      const admin = await adminFromRequest(req);
      if (!admin) {
        json(res, 401, { error: "Not logged in" });
        return true;
      }
      json(res, 200, { username: admin.username });
      return true;
    }

    if (path === "/api/admin/entitlements/defaults" && req.method === "GET") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      json(res, 200, defaultEntitlements());
      return true;
    }

    if (path === "/api/admin/tenants" && req.method === "GET") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      const rows = await dbQuery(
        `SELECT id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                webhook_secret_hash, token_ciphertext,
                notify_emails, notify_whatsapp, wablas_base_url,
                wablas_token_ciphertext, wablas_secret_ciphertext,
                duty_ping_interval_sec, duty_ping_quiet_sec, duty_ping_min_move_m,
                telematics_source,
                created_at, updated_at
         FROM tenants
         ORDER BY created_at DESC`,
      );
      json(res, 200, { tenants: rows.rows.map(publicTenantRow) });
      return true;
    }

    if (path === "/api/admin/tenants" && req.method === "POST") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (!secretsKeyConfigured()) {
        json(res, 503, { error: "FMS_SECRETS_KEY is required to store Armada tokens" });
        return true;
      }
      const body = await readJson(req);
      const key = String(body.key || "").trim();
      const appId = Number(body.appId);
      const token = String(body.token || "").trim();
      if (!isTenantKey(key)) {
        json(res, 400, { error: "Invalid embed key (8–80 chars: A–Z a–z 0–9 . _ -)" });
        return true;
      }
      if (!Number.isInteger(appId) || appId < 1) {
        json(res, 400, { error: "Invalid appId" });
        return true;
      }
      if (!token) {
        json(res, 400, { error: "Armada token is required" });
        return true;
      }
      const entitlements = mergeEntitlements(body.entitlements);
      const userIds = asIdList(body.userIds);
      const groupIds = asIdList(body.groupIds);
      const displayName = String(body.displayName || "").trim();
      const webhookSecret = String(body.webhookSecret || "").trim();
      const webhookHash = webhookSecret ? hashWebhookSecret(webhookSecret) : null;
      const tokenCipher = encryptSecret(token);
      const notifyEmails = String(body.notifyEmails || "").trim() || null;
      const notifyWhatsapp = String(body.notifyWhatsapp || "").trim() || null;
      const wablasBaseUrl = String(body.wablasBaseUrl || "").trim() || null;
      const wablasToken = String(body.wablasToken || "").trim();
      const wablasSecret = String(body.wablasSecret || "").trim();
      const wablasTokenCipher = wablasToken ? encryptSecret(wablasToken) : null;
      const wablasSecretCipher = wablasSecret ? encryptSecret(wablasSecret) : null;
      const inserted = await dbQuery(
        `INSERT INTO tenants (
           key, app_id, token_ciphertext, webhook_secret_hash, user_ids, group_ids, entitlements, enabled, display_name,
           notify_emails, notify_whatsapp, wablas_base_url, wablas_token_ciphertext, wablas_secret_ciphertext
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                   webhook_secret_hash, token_ciphertext,
                   notify_emails, notify_whatsapp, wablas_base_url,
                   wablas_token_ciphertext, wablas_secret_ciphertext,
                   created_at, updated_at`,
        [
          key,
          appId,
          tokenCipher,
          webhookHash,
          userIds,
          groupIds,
          JSON.stringify(entitlements),
          body.enabled !== false,
          displayName || null,
          notifyEmails,
          notifyWhatsapp,
          wablasBaseUrl,
          wablasTokenCipher,
          wablasSecretCipher,
        ],
      );
      await writeAudit(admin.id, "tenant.create", { key, appId });
      await initTenantVault();
      json(res, 201, { tenant: publicTenantRow(inserted.rows[0]) });
      return true;
    }

    if (path === "/api/admin/tracker-param-defs" && req.method === "GET") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      const tenantId = url.searchParams.get("tenantId") || "";
      json(res, 200, { params: await listParamDefs(tenantId || undefined) });
      return true;
    }

    if (path === "/api/admin/tracker-protocol-params" && req.method === "GET") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      const protocol = url.searchParams.get("protocol") || "";
      json(res, 200, { params: await listProtocolParams(protocol || undefined) });
      return true;
    }

    const tenantParamDefsMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-param-defs$/i.exec(path);
    if (tenantParamDefsMatch) {
      const tenantId = tenantParamDefsMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        json(res, 200, { params: await listParamDefs(tenantId) });
        return true;
      }
      if (req.method === "POST") {
        try {
          const body = await readJson(req);
          const param = await createParamDef(tenantId, body);
          await writeAudit(admin.id, "tracker_param_def.create", { tenantId, paramId: param.id });
          json(res, 201, { param });
        } catch (err) {
          json(res, err.status || 500, { error: err.message || "Create param failed" });
        }
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const tenantParamOneMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-param-defs\/([^/]+)$/i.exec(path);
    if (tenantParamOneMatch) {
      const tenantId = tenantParamOneMatch[1];
      const paramId = decodeURIComponent(tenantParamOneMatch[2]);
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "PATCH") {
        try {
          const body = await readJson(req);
          const param = await updateParamDef(tenantId, paramId, body);
          await writeAudit(admin.id, "tracker_param_def.update", { tenantId, paramId });
          json(res, 200, { param });
        } catch (err) {
          json(res, err.status || 500, { error: err.message || "Update param failed" });
        }
        return true;
      }
      if (req.method === "DELETE") {
        try {
          await deleteParamDef(tenantId, paramId);
          await writeAudit(admin.id, "tracker_param_def.delete", { tenantId, paramId });
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, err.status || 500, { error: err.message || "Delete param failed" });
        }
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const profilesMatch = /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-profiles$/i.exec(path);
    if (profilesMatch) {
      const tenantId = profilesMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        json(res, 200, { profiles: await listProfiles(tenantId) });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const profile = await createProfile(tenantId, body);
        await writeAudit(admin.id, "tracker_profile.create", { tenantId, profileId: profile.id });
        json(res, 201, { profile });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const profileOneMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-profiles\/([0-9a-f-]{36})$/i.exec(path);
    if (profileOneMatch) {
      const tenantId = profileOneMatch[1];
      const profileId = profileOneMatch[2];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "PATCH") {
        try {
          const body = await readJson(req);
          const profile = await updateProfile(tenantId, profileId, body);
          await writeAudit(admin.id, "tracker_profile.update", { tenantId, profileId });
          json(res, 200, { profile });
        } catch (err) {
          json(res, err.status || 500, { error: err.message || "Update profile failed" });
        }
        return true;
      }
      if (req.method === "DELETE") {
        try {
          await deleteProfile(tenantId, profileId);
          await writeAudit(admin.id, "tracker_profile.delete", { tenantId, profileId });
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, err.status || 500, { error: err.message || "Delete profile failed" });
        }
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const profileCloneMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-profiles\/([0-9a-f-]{36})\/clone$/i.exec(
        path,
      );
    if (profileCloneMatch) {
      const tenantId = profileCloneMatch[1];
      const profileId = profileCloneMatch[2];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "POST") {
        try {
          const body = await readJson(req);
          const profile = await cloneProfile(tenantId, profileId, body || {});
          await writeAudit(admin.id, "tracker_profile.clone", {
            tenantId,
            sourceId: profileId,
            profileId: profile.id,
          });
          json(res, 201, { profile });
        } catch (err) {
          json(res, err.status || 500, { error: err.message || "Clone profile failed" });
        }
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const terminalMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-terminal$/i.exec(path);
    if (terminalMatch) {
      const tenantId = terminalMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        const events = await listTerminalEvents(tenantId, {
          deviceId: url.searchParams.get("deviceId") || undefined,
          limit: Number(url.searchParams.get("limit") || 40),
        });
        json(res, 200, { events });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const mapsMatch = /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-param-maps$/i.exec(path);
    if (mapsMatch) {
      const tenantId = mapsMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        json(res, 200, {
          rules: await listMapRules({
            profileId: url.searchParams.get("profileId") || undefined,
            deviceId: url.searchParams.get("deviceId") || undefined,
          }),
        });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const rule = await upsertMapRule(body);
        await writeAudit(admin.id, "tracker_param_map.upsert", { tenantId, ruleId: rule.id });
        json(res, 201, { rule });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const mapOneMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-param-maps\/([0-9a-f-]{36})$/i.exec(path);
    if (mapOneMatch) {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "DELETE") {
        await deleteMapRule(mapOneMatch[2]);
        json(res, 200, { ok: true });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const previewMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-devices\/([0-9a-f-]{36})\/remap-preview$/i.exec(
        path,
      );
    if (previewMatch) {
      const tenantId = previewMatch[1];
      const deviceId = previewMatch[2];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        const last = await lastFixPreview(tenantId, deviceId);
        if (!last) {
          json(res, 200, { last: null, preview: { mapped: {}, rulesApplied: 0 } });
          return true;
        }
        const preview = await previewRemap(last.rawAttrs, { deviceId });
        json(res, 200, { last, preview });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    if (path === "/api/admin/tracker-gateway/status") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method !== "GET") {
        json(res, 405, { error: "Method not allowed" });
        return true;
      }
      const base = String(process.env.TRACKER_GATEWAY_URL || "http://127.0.0.1:5080").replace(
        /\/+$/,
        "",
      );
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 2500);
        const [healthRes, adaptersRes] = await Promise.all([
          fetch(`${base}/healthz`, { signal: ctrl.signal }),
          fetch(`${base}/adapters`, { signal: ctrl.signal }),
        ]);
        clearTimeout(t);
        const health = healthRes.ok ? await healthRes.json() : { ok: false, error: healthRes.status };
        const adapters = adaptersRes.ok
          ? await adaptersRes.json()
          : { error: adaptersRes.status };
        json(res, 200, { ok: true, base, health, adapters });
      } catch (err) {
        json(res, 200, {
          ok: false,
          base,
          error: err instanceof Error ? err.message : "Gateway unreachable",
        });
      }
      return true;
    }

    const commandOneMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-devices\/([0-9a-f-]{36})\/commands\/([0-9a-f-]{36})$/i.exec(
        path,
      );
    if (commandOneMatch) {
      const tenantId = commandOneMatch[1];
      const deviceId = commandOneMatch[2];
      const commandId = commandOneMatch[3];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "DELETE") {
        const command = await cancelCommand(tenantId, deviceId, commandId);
        await writeAudit(admin.id, "tracker_command.cancel", { tenantId, deviceId, commandId });
        json(res, 200, { command });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const commandsMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-devices\/([0-9a-f-]{36})\/commands$/i.exec(
        path,
      );
    if (commandsMatch) {
      const tenantId = commandsMatch[1];
      const deviceId = commandsMatch[2];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        json(res, 200, { commands: await listCommands(tenantId, deviceId) });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const command = await enqueueCommand(tenantId, deviceId, body);
        await writeAudit(admin.id, "tracker_command.enqueue", { tenantId, deviceId, commandId: command.id });
        json(res, 201, { command });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const safetyMatch = /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-safety-events$/i.exec(path);
    if (safetyMatch) {
      const tenantId = safetyMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        json(res, 200, {
          events: await listSafetyEvents(tenantId, {
            deviceId: url.searchParams.get("deviceId") || undefined,
            limit: Number(url.searchParams.get("limit") || 50),
          }),
        });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    if (path === "/api/admin/tracker-unassigned") {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "GET") {
        const lim = Number(url.searchParams.get("limit") || 100);
        json(res, 200, { unassigned: await listUnassignedTrackerImeis(lim) });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const unassignedOneMatch = /^\/api\/admin\/tracker-unassigned\/([^/]+)$/i.exec(path);
    if (unassignedOneMatch) {
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      const imei = decodeURIComponent(unassignedOneMatch[1]);
      if (req.method === "DELETE") {
        await dismissUnassignedTrackerImei(imei);
        await writeAudit(admin.id, "tracker_unassigned.dismiss", { imei });
        json(res, 200, { ok: true });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const claimUnassignedMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-devices\/claim-unassigned$/i.exec(path);
    if (claimUnassignedMatch) {
      const tenantId = claimUnassignedMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      const tenantOk = await dbQuery(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
      if (!tenantOk.rows[0]) {
        json(res, 404, { error: "Tenant not found" });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const device = await claimUnassignedTrackerImei(tenantId, body);
        await writeAudit(admin.id, "tracker_unassigned.claim", {
          tenantId,
          deviceId: device.id,
          imei: device.imei,
        });
        json(res, 201, { device });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const devicesListMatch = /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-devices$/i.exec(path);
    if (devicesListMatch) {
      const tenantId = devicesListMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      const tenantOk = await dbQuery(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
      if (!tenantOk.rows[0]) {
        json(res, 404, { error: "Tenant not found" });
        return true;
      }
      if (req.method === "GET") {
        json(res, 200, { devices: await listTrackerDevices(tenantId) });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const device = await createTrackerDevice(tenantId, body);
        await writeAudit(admin.id, "tracker_device.create", {
          tenantId,
          deviceId: device.id,
          imei: device.imei,
        });
        json(res, 201, { device });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const deviceOneMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/tracker-devices\/([0-9a-f-]{36})$/i.exec(path);
    if (deviceOneMatch) {
      const tenantId = deviceOneMatch[1];
      const deviceId = deviceOneMatch[2];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;
      if (req.method === "PATCH") {
        const body = await readJson(req);
        const device = await updateTrackerDevice(tenantId, deviceId, body);
        await writeAudit(admin.id, "tracker_device.update", { tenantId, deviceId });
        json(res, 200, { device });
        return true;
      }
      if (req.method === "DELETE") {
        await deleteTrackerDevice(tenantId, deviceId);
        await writeAudit(admin.id, "tracker_device.delete", { tenantId, deviceId });
        json(res, 200, { ok: true });
        return true;
      }
      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const fieldUsersListMatch = /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/field-users$/i.exec(path);
    if (fieldUsersListMatch) {
      const tenantId = fieldUsersListMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;

      const tenantOk = await dbQuery(`SELECT id FROM tenants WHERE id = $1`, [tenantId]);
      if (!tenantOk.rows[0]) {
        json(res, 404, { error: "Tenant not found" });
        return true;
      }

      if (req.method === "GET") {
        const rows = await dbQuery(
          `SELECT id, username, role, display_name, phone, email, enabled, privileges, created_at, updated_at
           FROM field_users WHERE tenant_id = $1 ORDER BY username ASC`,
          [tenantId],
        );
        json(res, 200, { users: rows.rows.map(publicFieldUserRow) });
        return true;
      }

      if (req.method === "POST") {
        const body = await readJson(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const role = String(body.role || "operator").trim();
        const displayName = String(body.displayName || "").trim();
        const phone = String(body.phone || "").trim() || null;
        const email = String(body.email || "").trim() || null;
        const privileges = normalizeDeskPrivilegesInput(body.privileges);
        if (!isFieldUsername(username)) {
          json(res, 400, { error: "Invalid username (2–64: A–Z a–z 0–9 . _ -)" });
          return true;
        }
        if (!password || password.length < 6) {
          json(res, 400, { error: "Password must be at least 6 characters" });
          return true;
        }
        if (!isFieldRole(role)) {
          json(res, 400, { error: `Role must be one of: ${FIELD_ROLES.join(", ")}` });
          return true;
        }
        const inserted = await dbQuery(
          `INSERT INTO field_users (tenant_id, username, password_hash, role, display_name, phone, email, enabled, privileges)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           RETURNING id, username, role, display_name, phone, email, enabled, privileges, created_at, updated_at`,
          [
            tenantId,
            username,
            hashPassword(password),
            role,
            displayName || null,
            phone,
            email,
            body.enabled !== false,
            JSON.stringify(privileges),
          ],
        );
        await writeAudit(admin.id, "field_user.create", { tenantId, username, role });
        json(res, 201, { user: publicFieldUserRow(inserted.rows[0]) });
        return true;
      }

      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const fieldUserMatch =
      /^\/api\/admin\/tenants\/([0-9a-f-]{36})\/field-users\/([0-9a-f-]{36})$/i.exec(path);
    if (fieldUserMatch) {
      const tenantId = fieldUserMatch[1];
      const userId = fieldUserMatch[2];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;

      if (req.method === "PATCH") {
        const body = await readJson(req);
        const found = await dbQuery(
          `SELECT * FROM field_users WHERE id = $1 AND tenant_id = $2`,
          [userId, tenantId],
        );
        const current = found.rows[0];
        if (!current) {
          json(res, 404, { error: "Field user not found" });
          return true;
        }

        let username = current.username;
        if (body.username !== undefined) {
          username = String(body.username || "").trim();
          if (!isFieldUsername(username)) {
            json(res, 400, { error: "Invalid username (2–64: A–Z a–z 0–9 . _ -)" });
            return true;
          }
        }
        let role = current.role;
        if (body.role !== undefined) {
          role = String(body.role || "").trim();
          if (!isFieldRole(role)) {
            json(res, 400, { error: `Role must be one of: ${FIELD_ROLES.join(", ")}` });
            return true;
          }
        }
        let passwordHash = current.password_hash;
        if (body.password !== undefined && String(body.password).trim()) {
          const password = String(body.password);
          if (password.length < 6) {
            json(res, 400, { error: "Password must be at least 6 characters" });
            return true;
          }
          passwordHash = hashPassword(password);
        }
        const displayName =
          body.displayName !== undefined
            ? String(body.displayName || "").trim() || null
            : current.display_name;
        const phone =
          body.phone !== undefined ? String(body.phone || "").trim() || null : current.phone;
        const email =
          body.email !== undefined ? String(body.email || "").trim() || null : current.email;
        const enabled =
          body.enabled !== undefined ? body.enabled !== false : current.enabled !== false;
        const privileges =
          body.privileges !== undefined
            ? normalizeDeskPrivilegesInput(body.privileges)
            : mergeDeskPrivileges(current.privileges);

        const updated = await dbQuery(
          `UPDATE field_users SET
             username = $3,
             role = $4,
             password_hash = $5,
             display_name = $6,
             phone = $7,
             email = $8,
             enabled = $9,
             privileges = $10::jsonb,
             updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING id, username, role, display_name, phone, email, enabled, privileges, created_at, updated_at`,
          [
            userId,
            tenantId,
            username,
            role,
            passwordHash,
            displayName,
            phone,
            email,
            enabled,
            JSON.stringify(privileges),
          ],
        );
        await writeAudit(admin.id, "field_user.update", {
          tenantId,
          userId,
          username,
          previousUsername: current.username,
          passwordRotated: Boolean(body.password && String(body.password).trim()),
        });
        json(res, 200, { user: publicFieldUserRow(updated.rows[0]) });
        return true;
      }

      if (req.method === "DELETE") {
        const deleted = await dbQuery(
          `DELETE FROM field_users WHERE id = $1 AND tenant_id = $2 RETURNING username`,
          [userId, tenantId],
        );
        if (!deleted.rows[0]) {
          json(res, 404, { error: "Field user not found" });
          return true;
        }
        await writeAudit(admin.id, "field_user.delete", {
          tenantId,
          userId,
          username: deleted.rows[0].username,
        });
        json(res, 200, { ok: true });
        return true;
      }

      json(res, 405, { error: "Method not allowed" });
      return true;
    }

    const tenantMatch = /^\/api\/admin\/tenants\/([0-9a-f-]{36})$/i.exec(path);
    if (tenantMatch) {
      const id = tenantMatch[1];
      const admin = await requireAdmin(req, res);
      if (!admin) return true;

      if (req.method === "GET") {
        const found = await dbQuery(
          `SELECT id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                  webhook_secret_hash, token_ciphertext,
                  notify_emails, notify_whatsapp, wablas_base_url,
                  wablas_token_ciphertext, wablas_secret_ciphertext,
                  duty_ping_interval_sec, duty_ping_quiet_sec, duty_ping_min_move_m,
                  telematics_source,
                  created_at, updated_at
           FROM tenants WHERE id = $1`,
          [id],
        );
        if (!found.rows[0]) {
          json(res, 404, { error: "Tenant not found" });
          return true;
        }
        json(res, 200, { tenant: publicTenantRow(found.rows[0]) });
        return true;
      }

      if (req.method === "PATCH") {
        if (!secretsKeyConfigured()) {
          json(res, 503, { error: "FMS_SECRETS_KEY is required to store Armada tokens" });
          return true;
        }
        const body = await readJson(req);
        const found = await dbQuery(`SELECT * FROM tenants WHERE id = $1`, [id]);
        const current = found.rows[0];
        if (!current) {
          json(res, 404, { error: "Tenant not found" });
          return true;
        }

        let key = current.key;
        if (body.key !== undefined) {
          key = String(body.key || "").trim();
          if (!isTenantKey(key)) {
            json(res, 400, { error: "Invalid embed key" });
            return true;
          }
        }
        let appId = Number(current.app_id);
        if (body.appId !== undefined) {
          appId = Number(body.appId);
          if (!Number.isInteger(appId) || appId < 1) {
            json(res, 400, { error: "Invalid appId" });
            return true;
          }
        }
        let tokenCipher = current.token_ciphertext;
        if (body.token !== undefined && String(body.token).trim()) {
          tokenCipher = encryptSecret(String(body.token).trim());
        }
        let webhookHash = current.webhook_secret_hash;
        if (body.webhookSecret !== undefined) {
          const secret = String(body.webhookSecret || "").trim();
          webhookHash = secret ? hashWebhookSecret(secret) : null;
        }
        const userIds = body.userIds !== undefined ? asIdList(body.userIds) : current.user_ids;
        const groupIds = body.groupIds !== undefined ? asIdList(body.groupIds) : current.group_ids;
        const entitlements =
          body.entitlements !== undefined
            ? mergeEntitlements(body.entitlements)
            : mergeEntitlements(current.entitlements);
        const enabled = body.enabled !== undefined ? body.enabled !== false : current.enabled !== false;
        const displayName =
          body.displayName !== undefined
            ? String(body.displayName || "").trim() || null
            : current.display_name;

        const notifyEmails =
          body.notifyEmails !== undefined
            ? String(body.notifyEmails || "").trim() || null
            : current.notify_emails;
        const notifyWhatsapp =
          body.notifyWhatsapp !== undefined
            ? String(body.notifyWhatsapp || "").trim() || null
            : current.notify_whatsapp;
        const wablasBaseUrl =
          body.wablasBaseUrl !== undefined
            ? String(body.wablasBaseUrl || "").trim() || null
            : current.wablas_base_url;
        let wablasTokenCipher = current.wablas_token_ciphertext;
        if (body.wablasToken !== undefined && String(body.wablasToken).trim()) {
          wablasTokenCipher = encryptSecret(String(body.wablasToken).trim());
        }
        let wablasSecretCipher = current.wablas_secret_ciphertext;
        if (body.wablasSecret !== undefined && String(body.wablasSecret).trim()) {
          wablasSecretCipher = encryptSecret(String(body.wablasSecret).trim());
        }
        const dutyLocation = normalizeDutyLocationPolicy(
          body.dutyLocation !== undefined
            ? body.dutyLocation
            : {
                intervalSec: current.duty_ping_interval_sec,
                quietSec: current.duty_ping_quiet_sec,
                minMoveM: current.duty_ping_min_move_m,
              },
        );
        const telematicsSource =
          body.telematicsSource !== undefined
            ? normalizeTelematicsSource(body.telematicsSource)
            : normalizeTelematicsSource(current.telematics_source);

        const updated = await dbQuery(
          `UPDATE tenants SET
             key = $2,
             app_id = $3,
             token_ciphertext = $4,
             webhook_secret_hash = $5,
             user_ids = $6,
             group_ids = $7,
             entitlements = $8::jsonb,
             enabled = $9,
             display_name = $10,
             notify_emails = $11,
             notify_whatsapp = $12,
             wablas_base_url = $13,
             wablas_token_ciphertext = $14,
             wablas_secret_ciphertext = $15,
             duty_ping_interval_sec = $16,
             duty_ping_quiet_sec = $17,
             duty_ping_min_move_m = $18,
             telematics_source = $19,
             updated_at = now()
           WHERE id = $1
           RETURNING id, key, app_id, display_name, enabled, user_ids, group_ids, entitlements,
                     webhook_secret_hash, token_ciphertext,
                     notify_emails, notify_whatsapp, wablas_base_url,
                     wablas_token_ciphertext, wablas_secret_ciphertext,
                     duty_ping_interval_sec, duty_ping_quiet_sec, duty_ping_min_move_m,
                     telematics_source,
                     created_at, updated_at`,
          [
            id,
            key,
            appId,
            tokenCipher,
            webhookHash,
            userIds,
            groupIds,
            JSON.stringify(entitlements),
            enabled,
            displayName,
            notifyEmails,
            notifyWhatsapp,
            wablasBaseUrl,
            wablasTokenCipher,
            wablasSecretCipher,
            dutyLocation.intervalSec,
            dutyLocation.quietSec,
            dutyLocation.minMoveM,
            telematicsSource,
          ],
        );
        await writeAudit(admin.id, "tenant.update", {
          id,
          key,
          tokenRotated: Boolean(body.token && String(body.token).trim()),
        });
        await initTenantVault();
        json(res, 200, { tenant: publicTenantRow(updated.rows[0]) });
        return true;
      }

      if (req.method === "DELETE") {
        const deleted = await dbQuery(`DELETE FROM tenants WHERE id = $1 RETURNING key`, [id]);
        if (!deleted.rows[0]) {
          json(res, 404, { error: "Tenant not found" });
          return true;
        }
        await writeAudit(admin.id, "tenant.delete", { id, key: deleted.rows[0].key });
        await initTenantVault();
        json(res, 200, { ok: true });
        return true;
      }
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("duplicate key") || message.includes("unique")) {
      json(res, 409, {
        error: message.includes("field_users")
          ? "Username already exists for this tenant"
          : message.includes("tracker_devices")
            ? "IMEI already registered for this tenant"
            : "Embed key already exists",
      });
      return true;
    }
    console.error("[admin]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}

// re-export for boot
export { maybeBootstrapAdmin };
