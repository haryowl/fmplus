/**
 * Fetch real Event/Alert samples once we know required query params.
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

async function main() {
  const env = loadEnvLocal();
  const auth = String(env.ARMADA_AUTH_HEADER || "").trim();
  const appId = Number(env.ARMADA_APP_ID || 36);
  const userId = 1859;
  const date = "2026-08-15";
  const base = `https://armada.id/lt/api/v.1/applications/${appId}`;

  const paths = [
    `/events?Date=${date}&userId=${userId}`,
    `/events?Date=${date}&UserId=${userId}`,
    `/events?Date=${date}&UserID=${userId}`,
    `/Events?Date=${date}&userId=${userId}`,
    `/events?Date=${date}&groupId=1`,
    `/eventrules`,
  ];

  const results = [];
  for (const p of paths) {
    process.stderr.write(`GET ${p}\n`);
    const res = await get(`${base}${p}`, auth);
    const json = res.json;
    let sample = json;
    if (Array.isArray(json)) {
      sample = {
        count: json.length,
        first3: json.slice(0, 3),
        keys: json[0] && typeof json[0] === "object" ? Object.keys(json[0]) : [],
      };
    } else if (json && typeof json === "object" && Array.isArray(json.items)) {
      sample = {
        count: json.items.length,
        first3: json.items.slice(0, 3),
        keys: json.items[0] ? Object.keys(json.items[0]) : [],
        topKeys: Object.keys(json),
      };
    }
    results.push({ path: p, status: res.status, bytes: res.bytes, sample, rawText: typeof json === "string" ? json : undefined });
  }

  const out = path.join(root, "tmp-events-sample.json");
  fs.writeFileSync(out, JSON.stringify({ fetchedAt: new Date().toISOString(), appId, userId, date, results }, null, 2));
  console.log(`Wrote ${out}`);
  for (const r of results) {
    const count = r.sample?.count != null ? ` count=${r.sample.count}` : "";
    console.log(`${r.status}\t${r.path}${count}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
