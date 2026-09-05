import { databaseUrlConfigured, dbHealth } from "./db.mjs";
import { secretsKeyConfigured } from "./crypto-secrets.mjs";
import { objectStorageConfigured, storageHealth } from "./storage.mjs";
import { securityHeaders } from "./proxy-lt.mjs";

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

/** GET /api/health — infra readiness (no secrets). */
export async function handleHealthRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname !== "/api/health") return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed");
    return true;
  }

  const db = await dbHealth();
  const storage = objectStorageConfigured() ? await storageHealth() : { ok: false, configured: false };

  const body = {
    ok: true,
    database: {
      configured: databaseUrlConfigured(),
      reachable: db.ok,
      error: db.error || undefined,
    },
    secretsKey: { configured: secretsKeyConfigured() },
    objectStorage: {
      configured: storage.configured,
      reachable: storage.ok,
      bucket: storage.bucket,
      error: storage.error || undefined,
    },
  };

  send(res, 200, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(body));
  return true;
}
