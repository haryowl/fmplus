/**
 * Operator vault. GpsGate tokens never leave the server.
 * tenants.json (gitignored) or TENANTS_JSON, plus optional ARMADA_AUTH_HEADER default.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_RE = /^[A-Za-z0-9._-]{8,80}$/;

/** @typedef {{ key: string, appId: number, token: string, userIds: number[], groupIds: number[] }} Tenant */

let cache = null;

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function asTenant(key, raw) {
  if (!raw || typeof raw !== "object") return null;
  const appId = Number(raw.appId);
  const token = String(raw.token || "").trim();
  if (!Number.isInteger(appId) || appId < 1 || !token) return null;
  return {
    key,
    appId,
    token,
    userIds: asIdList(raw.userIds),
    groupIds: asIdList(raw.groupIds),
  };
}

function loadVault() {
  /** @type {Map<string, Tenant>} */
  const map = new Map();
  const file = path.join(root, "tenants.json");
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (!KEY_RE.test(key)) continue;
          const tenant = asTenant(key, value);
          if (tenant) map.set(key, tenant);
        }
      }
    } catch {
      console.error("tenants.json is not valid JSON");
    }
  }
  const inline = process.env.TENANTS_JSON;
  if (inline) {
    try {
      const parsed = JSON.parse(inline);
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          if (!KEY_RE.test(key)) continue;
          const tenant = asTenant(key, value);
          if (tenant) map.set(key, tenant);
        }
      }
    } catch {
      console.error("TENANTS_JSON is not valid JSON");
    }
  }
  const fallbackToken = String(process.env.ARMADA_AUTH_HEADER || "").trim();
  const fallbackApp = Number(process.env.ARMADA_APP_ID || 36);
  if (fallbackToken && Number.isInteger(fallbackApp) && fallbackApp > 0) {
    map.set("", {
      key: "",
      appId: fallbackApp,
      token: fallbackToken,
      userIds: [],
      groupIds: [],
    });
  }
  return map;
}

export function reloadTenants() {
  cache = loadVault();
  return cache;
}

function vault() {
  if (!cache) cache = loadVault();
  return cache;
}

export function isTenantKey(value) {
  return typeof value === "string" && KEY_RE.test(value);
}

export function tenantFromRequest(req) {
  const header = String(req.headers["x-fms-tenant"] || "").trim();
  if (header) return vault().get(header) || null;
  return vault().get("") || null;
}

export function publicTenant(tenant) {
  if (!tenant) return null;
  return {
    appId: tenant.appId,
    userIds: tenant.userIds,
    groupIds: tenant.groupIds,
  };
}

export function tenantAllowsUser(tenant, userId) {
  if (!tenant || tenant.userIds.length === 0) return true;
  return tenant.userIds.includes(Number(userId));
}

export function tenantAllowsGroup(tenant, groupId) {
  if (!tenant || tenant.groupIds.length === 0) return true;
  return tenant.groupIds.includes(Number(groupId));
}

export function defaultFrameAncestors() {
  return process.env.EMBED_FRAME_ANCESTORS || "'self' https://armada.id https://*.armada.id";
}

export function originAllowed(origin, patterns) {
  if (!origin) return false;
  const list = Array.isArray(patterns) ? patterns : [];
  if (list.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  for (const pattern of list) {
    if (pattern === origin) return true;
    const wild = /^(https?:\/\/)\*\.(.+)$/i.exec(pattern);
    if (!wild) continue;
    if (`${parsed.protocol}//` !== wild[1]) continue;
    const rootHost = wild[2].toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (host === rootHost || host.endsWith(`.${rootHost}`)) return true;
  }
  return false;
}

export function applicationIdFromLtUrl(urlPath) {
  const pathOnly = (urlPath || "").split("?")[0];
  const match = /^\/lt\/api\/v\.1\/applications\/(\d+)(?:\/|$)/.exec(pathOnly);
  return match ? Number(match[1]) : null;
}

export function restPathFromLtUrl(urlPath) {
  const raw = urlPath || "";
  const match = /^\/lt\/api\/v\.1\/applications\/\d+(\/[^?]*)?/.exec(raw.split("?")[0]);
  return match?.[1] || "/";
}

function unwrapList(raw) {
  if (Array.isArray(raw)) return { list: raw, wrap: false };
  if (raw && Array.isArray(raw.items)) return { list: raw.items, wrap: true };
  return null;
}

export function filterArmadaList(raw, tenant, kind) {
  const unpacked = unwrapList(raw);
  if (!unpacked) return raw;
  let list = unpacked.list;
  if (kind === "users" && tenant.userIds.length) {
    const allow = new Set(tenant.userIds);
    list = list.filter((item) => allow.has(Number(item?.id ?? item?.userId)));
  } else if (kind === "groups" && tenant.groupIds.length) {
    const allow = new Set(tenant.groupIds);
    list = list.filter((item) => allow.has(Number(item?.id ?? item?.groupId)));
  } else if (kind === "groups" && tenant.userIds.length) {
    const allow = new Set(tenant.userIds);
    list = list.filter((item) => {
      const ids = Array.isArray(item?.usersIds) ? item.usersIds.map(Number) : [];
      return ids.some((id) => allow.has(id));
    });
  } else if (kind === "trackinfos" && tenant.userIds.length) {
    const allow = new Set(tenant.userIds);
    list = list.filter((item) => allow.has(Number(item?.userId)));
  } else if (kind === "usersstatus" && tenant.userIds.length) {
    const allow = new Set(tenant.userIds);
    list = list.filter((item) => allow.has(Number(item?.id ?? item?.userId)));
  }
  return unpacked.wrap ? { ...raw, items: list } : list;
}

export function listFilterKind(restPath) {
  const p = (restPath || "/").split("?")[0];
  if (p === "/users") return "users";
  if (p === "/groups") return "groups";
  if (p === "/trackinfos") return "trackinfos";
  if (p === "/usersstatus") return "usersstatus";
  return "";
}
