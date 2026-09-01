/**
 * Serves the built dashboard and proxies Armada `/lt` with a server-side token.
 * The browser never receives ARMADA_AUTH_HEADER.
 *
 *   npm run build
 *   npm start
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAnalyzeRequest } from "./server/analyze.mjs";

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
const auth = process.env.ARMADA_AUTH_HEADER || "";
const frameAncestors = process.env.EMBED_FRAME_ANCESTORS || "'self'";

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

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": `frame-ancestors ${frameAncestors}`,
    "Cache-Control": extra["Cache-Control"] || "no-store",
    ...extra,
  };
}

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

async function proxyLt(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed");
    return;
  }
  if (!auth) {
    send(
      res,
      503,
      { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({ error: "ARMADA_AUTH_HEADER is not set on the server" }),
    );
    return;
  }

  const url = `https://armada.id${req.url}`;
  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        authorization: auth,
        accept: req.headers.accept || "application/json",
      },
      redirect: "follow",
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    send(res, upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    }, buf);
  } catch {
    send(res, 502, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Armada proxy failed" }));
  }
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0] || "/");
  const rel = decoded.replace(/^\/+/, "").replace(/\\/g, "/") || "index.html";
  if (rel.split("/").includes("..")) return null;
  const file = path.resolve(dist, rel);
  const root = path.resolve(dist);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
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

const server = http.createServer((req, res) => {
  void (async () => {
    const urlPath = req.url || "/";
    if (await handleAnalyzeRequest(req, res)) return;
    if (urlPath === "/lt" || urlPath.startsWith("/lt/")) {
      await proxyLt(req, res);
      return;
    }
    serveStatic(req, res);
  })();
});

server.listen(port, () => {
  const ready = auth ? "Armada proxy enabled" : "ARMADA_AUTH_HEADER missing";
  console.log(`Vehicle Metrics on http://localhost:${port} (${ready})`);
});
