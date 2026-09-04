/**
 * One-shot: fetch 1 day for 2 vehicles and dump field inventory (no auth printed).
 * Usage: node scripts/sample-armada-day.mjs
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

function armadaGet(url, auth) {
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
        timeout: 120_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode || 0, body });
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

function collectVarNames(points) {
  const names = new Map();
  for (const p of points) {
    const vars = p?.variables;
    if (Array.isArray(vars)) {
      for (const item of vars) {
        if (item && typeof item.name === "string") {
          names.set(item.name, (names.get(item.name) || 0) + 1);
        }
      }
    } else if (vars && typeof vars === "object") {
      for (const key of Object.keys(vars)) {
        names.set(key, (names.get(key) || 0) + 1);
      }
    }
  }
  return [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function topLevelKeys(points) {
  const keys = new Map();
  for (const p of points) {
    if (!p || typeof p !== "object") continue;
    for (const key of Object.keys(p)) keys.set(key, (keys.get(key) || 0) + 1);
  }
  return [...keys.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function positionKeys(points) {
  const keys = new Map();
  for (const p of points) {
    const pos = p?.position;
    if (!pos || typeof pos !== "object") continue;
    for (const key of Object.keys(pos)) keys.set(key, (keys.get(key) || 0) + 1);
  }
  return [...keys.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function pickSample(points) {
  // Prefer a moving/ignition-on point if possible
  for (const p of points) {
    const vars = Array.isArray(p.variables) ? p.variables : [];
    const byName = Object.fromEntries(
      vars.filter((v) => v && typeof v.name === "string").map((v) => [v.name, v.value]),
    );
    if (Number(byName.speed) > 0 || byName.ignition === true || byName.ignition === 1) {
      return p;
    }
  }
  return points[0] || null;
}

async function fetchDay(appId, userId, date, auth) {
  const url = `https://armada.id/lt/api/v.1/applications/${appId}/users/${userId}/tracks?Date=${encodeURIComponent(date)}&Filtered=true`;
  const res = await armadaGet(url, auth);
  if (res.status === 404) return { userId, date, status: 404, points: [], bytes: 0 };
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`user ${userId} day ${date}: Armada ${res.status}`);
  }
  const parsed = JSON.parse(res.body || "[]");
  const points = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  return { userId, date, status: res.status, points, bytes: Buffer.byteLength(res.body || "") };
}

async function main() {
  const env = loadEnvLocal();
  const auth = String(env.ARMADA_AUTH_HEADER || "").trim();
  const appId = Number(env.ARMADA_APP_ID || 36);
  if (!auth) {
    console.error("Missing ARMADA_AUTH_HEADER in .env.local");
    process.exit(1);
  }

  // Two vehicles from recent Fleet use; quiet-ish mid-month day to keep payload smaller.
  const userIds = [1859, 1860];
  const date = "2026-08-15";

  const vehicles = [];
  for (const userId of userIds) {
    process.stderr.write(`Fetching user ${userId} ${date}…\n`);
    const day = await fetchDay(appId, userId, date, auth);
    vehicles.push(day);
  }

  const report = {
    fetchedAt: new Date().toISOString(),
    appId,
    date,
    note: "Auth token omitted. variables below are the full Armada names seen on these two vehicle-days.",
    vehicles: vehicles.map((v) => ({
      userId: v.userId,
      date: v.date,
      httpStatus: v.status,
      pointCount: v.points.length,
      rawBytes: v.bytes,
      topLevelKeys: topLevelKeys(v.points),
      positionKeys: positionKeys(v.points),
      variableNames: collectVarNames(v.points),
      sampleRawPoint: pickSample(v.points),
    })),
    whatDashboardKeepsToday: {
      topLevel: ["utc", "position.latitude|longitude|altitude", "trackInfoId", "variables (filtered)"],
      variables: [
        "speed",
        "ignition",
        "odometerAcc",
        "caN300_EngineRPM",
        "caN300_FuelConsumed",
        "fuel level / fuelLevel / FuelLevel",
        "axisX/Y/Z",
        "harshBrakingDigital/Value",
        "harshAccelerationDigital/Value",
        "harshCorneringDigital/Value",
      ],
    },
  };

  const outPath = path.join(root, "tmp-armada-sample.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Wrote ${outPath}`);
  for (const v of report.vehicles) {
    console.log(
      `user ${v.userId}: ${v.pointCount} points, ${v.rawBytes} bytes, ${v.variableNames.length} variable names`,
    );
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
