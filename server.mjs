/**
 * Serves the built dashboard and proxies Armada `/lt` with a server-side token.
 * The browser never receives ARMADA_AUTH_HEADER or tenant tokens.
 *
 *   npm run build
 *   npm start
 *
 * HTTPS is used when ssl/server.key and ssl/server.crt exist (or SSL_KEY / SSL_CERT).
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAnalyzeRequest } from "./server/analyze.mjs";
import { handleEmbedContextRequest } from "./server/embed-context.mjs";
import { handleLtProxyRequest, securityHeaders } from "./server/proxy-lt.mjs";
import { handleTracksBatchRequest } from "./server/tracks-batch.mjs";
import { handleUserDayTracksRequest } from "./server/user-day-tracks.mjs";
import { handleNearbyFuelRequest } from "./server/nearby-fuel.mjs";
import { handleHealthRequest } from "./server/health.mjs";
import { handleAdminRequest, maybeBootstrapAdmin } from "./server/admin-api.mjs";
import { handleFieldRequest } from "./server/field-api.mjs";
import { handleArmadaNotifyRequest } from "./server/armada-notify.mjs";
import { handleExceptionsRequest } from "./server/exceptions-api.mjs";
import { initTenantVault, tenantFromRequest } from "./server/tenants.mjs";
import { runMigrations } from "./server/db/migrate.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));

const port = Number(process.env.PORT || 4173);

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0] || "/");
  const rel = decoded.replace(/^\/+/, "").replace(/\\/g, "/") || "index.html";
  if (rel.split("/").includes("..")) return null;
  const file = path.resolve(dist, rel);
  const rootDir = path.resolve(dist);
  if (file !== rootDir && !file.startsWith(rootDir + path.sep)) return null;
  return file;
}

function serveStatic(req, res) {
  const file = safeFile(req.url || "/");
  const index = path.join(dist, "index.html");
  let target = file && fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
  if (!target && fs.existsSync(index)) target = index;
  if (!target) {
    send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found. Run npm run build first.");
    return;
  }
  const ext = path.extname(target);
  const immutable = target !== index && ext !== ".html";
  send(res, 200, {
    "Content-Type": mime[ext] || "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-store",
  }, fs.readFileSync(target));
}

function onRequest(req, res) {
  void (async () => {
    if (await handleHealthRequest(req, res)) return;
    if (await handleArmadaNotifyRequest(req, res)) return;
    if (await handleExceptionsRequest(req, res)) return;
    if (await handleAdminRequest(req, res)) return;
    if (await handleFieldRequest(req, res)) return;
    if (await handleEmbedContextRequest(req, res)) return;
    if (await handleTracksBatchRequest(req, res)) return;
    if (await handleUserDayTracksRequest(req, res)) return;
    if (await handleNearbyFuelRequest(req, res)) return;
    if (await handleAnalyzeRequest(req, res)) return;
    if (await handleLtProxyRequest(req, res)) return;
    serveStatic(req, res);
  })();
}

function loadSslOptions() {
  const keyPath = process.env.SSL_KEY
    ? path.resolve(root, process.env.SSL_KEY)
    : path.join(root, "ssl", "server.key");
  const certPath = process.env.SSL_CERT
    ? path.resolve(root, process.env.SSL_CERT)
    : path.join(root, "ssl", "server.crt");
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) return null;
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
}

const ssl = loadSslOptions();
const server = ssl ? https.createServer(ssl, onRequest) : http.createServer(onRequest);

server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.timeout = 0;

async function boot() {
  try {
    await runMigrations();
    await initTenantVault();
    await maybeBootstrapAdmin();
  } catch (err) {
    console.error("[boot] vault/db init:", err instanceof Error ? err.message : err);
  }
  server.listen(port, () => {
    const scheme = ssl ? "https" : "http";
    const ready = tenantFromRequest({ headers: {} }) ? "Armada proxy enabled" : "no default tenant token";
    console.log(`Vehicle Metrics on ${scheme}://localhost:${port} (${ready})`);
  });
}

void boot();
