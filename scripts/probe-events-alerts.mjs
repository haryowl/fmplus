/**
 * Probe Armada/GpsGate endpoints for Events / Alerts (auth never printed).
 * Usage: node scripts/probe-events-alerts.mjs
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
    return value.slice(0, 3).map((item) => summarize(item, depth + 1));
  }
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(value)) {
    if (/token|auth|password|secret/i.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (n++ > 40) {
      out["…"] = "truncated";
      break;
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

function findEventish(obj, pathSoFar = "", hits = []) {
  if (!obj || typeof obj !== "object") return hits;
  if (Array.isArray(obj)) {
    obj.slice(0, 30).forEach((item, i) => findEventish(item, `${pathSoFar}[${i}]`, hits));
    return hits;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = pathSoFar ? `${pathSoFar}.${k}` : k;
    if (/event|alert|notif|alarm|rule|geofence|exception/i.test(k)) {
      hits.push({ path: p, sample: summarize(v) });
    }
    if (v && typeof v === "object" && pathSoFar.split(".").length < 5) findEventish(v, p, hits);
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
  const from = "2026-08-15T00:00:00Z";
  const to = "2026-08-16T00:00:00Z";
  const base = `https://armada.id/lt/api/v.1/applications/${appId}`;

  const paths = [
    `/events`,
    `/Events`,
    `/alerts`,
    `/Alerts`,
    `/notifications`,
    `/Notifications`,
    `/eventrules`,
    `/EventRules`,
    `/eventRules`,
    `/exceptions`,
    `/alarms`,
    `/geofences`,
    `/Geofences`,
    `/users/${userId}/events`,
    `/users/${userId}/Events`,
    `/users/${userId}/alerts`,
    `/users/${userId}/Alerts`,
    `/users/${userId}/notifications`,
    `/users/${userId}/exceptions`,
    `/users/${userId}/eventrules`,
    `/users/${userId}/events?From=${encodeURIComponent(from)}&To=${encodeURIComponent(to)}`,
    `/users/${userId}/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    `/users/${userId}/events?Date=2026-08-15`,
    `/users/${userId}/alerts?From=${encodeURIComponent(from)}&To=${encodeURIComponent(to)}`,
    `/events?From=${encodeURIComponent(from)}&To=${encodeURIComponent(to)}`,
    `/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    `/events?Date=2026-08-15`,
    `/events?UserId=${userId}`,
    `/events?userId=${userId}&From=${encodeURIComponent(from)}&To=${encodeURIComponent(to)}`,
    `/alerts?From=${encodeURIComponent(from)}&To=${encodeURIComponent(to)}`,
    `/alerts?UserId=${userId}`,
    `/notifications?From=${encodeURIComponent(from)}&To=${encodeURIComponent(to)}`,
    `/users/${userId}/status`,
    `/users/${userId}/tracks?Date=2026-08-15&Filtered=true`,
  ];

  const results = [];
  for (const p of paths) {
    const url = `${base}${p}`;
    process.stderr.write(`GET ${p}\n`);
    try {
      const res = await get(url, auth);
      const hits = findEventish(res.json);
      let listLen = null;
      if (Array.isArray(res.json)) listLen = res.json.length;
      else if (Array.isArray(res.json?.items)) listLen = res.json.items.length;

      // For tracks, only keep eventID-related summary, not full points
      let summary = summarize(res.json);
      if (p.includes("/tracks")) {
        const points = Array.isArray(res.json) ? res.json : res.json?.items || [];
        const eventIds = new Map();
        for (const pt of points.slice(0, 5000)) {
          const vars = pt?.variables;
          let eid;
          if (Array.isArray(vars)) {
            const row = vars.find((v) => v && v.name === "eventID");
            eid = row?.value;
          } else if (vars && typeof vars === "object") {
            eid = vars.eventID;
          }
          if (eid !== undefined && eid !== null && eid !== "") {
            eventIds.set(String(eid), (eventIds.get(String(eid)) || 0) + 1);
          }
        }
        summary = {
          pointCount: points.length,
          eventIDCounts: [...eventIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
          note: "Tracks carry eventID inside variables; not a separate Events API payload.",
        };
      }

      results.push({
        path: p,
        status: res.status,
        bytes: res.bytes,
        listLen,
        eventishHits: hits.slice(0, 20),
        summary,
      });
    } catch (err) {
      results.push({ path: p, status: "error", error: String(err.message || err) });
    }
  }

  const outPath = path.join(root, "tmp-events-alerts-probe.json");
  fs.writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), appId, userId, results }, null, 2));
  console.log(`Wrote ${outPath}`);
  for (const r of results) {
    const extra =
      r.listLen != null
        ? ` list=${r.listLen}`
        : r.eventishHits?.length
          ? ` hits=${r.eventishHits.length}`
          : "";
    console.log(`${r.status}\t${r.path}${extra}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
