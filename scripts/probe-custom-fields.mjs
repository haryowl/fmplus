/**
 * Probe Armada/GpsGate endpoints for Custom Field data (auth never printed).
 * Usage: node scripts/probe-custom-fields.mjs
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const file = path.join(root, ".env.local");
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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
    out[key] = value;
  }
  return out;
}

function get(url, auth) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: { authorization: auth, accept: "application/json" },
        timeout: 60_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(body || "null");
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, body, json, bytes: Buffer.byteLength(body) });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

function summarize(value, depth = 0) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (depth > 2) return `[array ${value.length}]`;
    return value.slice(0, 2).map((item) => summarize(item, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/token|auth|password|secret/i.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (depth > 3) {
      out[k] = typeof v;
      continue;
    }
    if (Array.isArray(v)) out[k] = `array(${v.length})`;
    else if (v && typeof v === "object") out[k] = summarize(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

function findCustomish(obj, pathSoFar = "", hits = []) {
  if (!obj || typeof obj !== "object") return hits;
  if (Array.isArray(obj)) {
    obj.slice(0, 20).forEach((item, i) => findCustomish(item, `${pathSoFar}[${i}]`, hits));
    return hits;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = pathSoFar ? `${pathSoFar}.${k}` : k;
    if (/custom/i.test(k)) {
      hits.push({ path: p, sample: summarize(v) });
    }
    if (v && typeof v === "object") findCustomish(v, p, hits);
  }
  return hits;
}

async function main() {
  const env = loadEnvLocal();
  const auth = String(env.ARMADA_AUTH_HEADER || "").trim();
  const appId = Number(env.ARMADA_APP_ID || 36);
  if (!auth) {
    console.error("Missing ARMADA_AUTH_HEADER in .env.local");
    process.exit(1);
  }

  const userId = 1859;
  const base = `https://armada.id/lt/api/v.1/applications/${appId}`;
  const paths = [
    `/users/${userId}`,
    `/users/${userId}?Select=customFields`,
    `/users/${userId}?Select=*`,
    `/users/${userId}/customfields`,
    `/users/${userId}/customFields`,
    `/users/${userId}/fields`,
    `/users/${userId}/variables`,
    `/devices`,
    `/devices/${userId}`,
    `/customfields`,
    `/customFields`,
    `/CustomFields`,
    `/variables`,
    `/variabledefinitions`,
    `/VariableDefinitions`,
    `/fields`,
    `/users?Take=2`,
    `/users?Take=2&Select=customFields`,
    `/users?Take=2&Select=*`,
    `/users/${userId}/device`,
    `/users/${userId}/status`,
  ];

  const results = [];
  for (const p of paths) {
    const url = `${base}${p}`;
    process.stderr.write(`GET ${p}\n`);
    try {
      const res = await get(url, auth);
      const hits = findCustomish(res.json);
      results.push({
        path: p,
        status: res.status,
        bytes: res.bytes,
        customHits: hits,
        summary: summarize(res.json),
      });
    } catch (err) {
      results.push({ path: p, status: "error", error: String(err.message || err) });
    }
  }

  const outPath = path.join(root, "tmp-custom-fields-probe.json");
  fs.writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), appId, userId, results }, null, 2));
  console.log(`Wrote ${outPath}`);
  for (const r of results) {
    const hit = r.customHits?.length ? ` customHits=${r.customHits.length}` : "";
    console.log(`${r.status}\t${r.path}${hit}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
