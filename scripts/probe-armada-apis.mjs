/**
 * Probe Armada/GpsGate REST for Phase C/D readiness.
 * Auth never printed. Writes docs/armada-api-probe.md
 *
 *   node scripts/probe-armada-apis.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { armadaFetch } from "../server/armada-fetch.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function summarizeBody(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { kind: "empty", preview: "" };
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return { kind: "array", count: parsed.length, preview: JSON.stringify(parsed.slice(0, 1)).slice(0, 180) };
    }
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed).slice(0, 12);
      const items = Array.isArray(parsed.items) ? parsed.items.length : null;
      return {
        kind: "object",
        keys,
        itemCount: items,
        preview: JSON.stringify(parsed).slice(0, 180),
      };
    }
    return { kind: typeof parsed, preview: String(parsed).slice(0, 120) };
  } catch {
    return { kind: "text", preview: trimmed.slice(0, 120) };
  }
}

async function probe(base, token, label, pathAndQuery) {
  const url = `${base}${pathAndQuery}`;
  try {
    const res = await armadaFetch(url, {
      headers: { Authorization: token, Accept: "application/json" },
      timeoutMs: 30_000,
    });
    const text = await res.text();
    const summary = summarizeBody(text);
    return {
      label,
      path: pathAndQuery,
      status: res.status,
      ok: res.ok,
      ...summary,
    };
  } catch (err) {
    return {
      label,
      path: pathAndQuery,
      status: 0,
      ok: false,
      kind: "error",
      preview: err instanceof Error ? err.message : String(err),
    };
  }
}

function verdict(row) {
  if (row.ok) return "YES";
  if (row.status === 401 || row.status === 403) return "DENIED";
  if (row.status === 404) return "NO/404";
  if (row.status === 0) return "ERROR";
  return `HTTP_${row.status}`;
}

loadEnvLocal();

const token = String(process.env.ARMADA_AUTH_HEADER || "").trim();
const appId = Number(process.env.ARMADA_APP_ID || 36);
if (!token) {
  console.error("Missing ARMADA_AUTH_HEADER");
  process.exit(1);
}
if (!Number.isInteger(appId) || appId < 1) {
  console.error("Invalid ARMADA_APP_ID");
  process.exit(1);
}

const base = `https://armada.id/lt/api/v.1/applications/${appId}`;
const today = new Date().toISOString().slice(0, 10);

const jobs = [
  ["geofencegroups", "/geofencegroups?FromIndex=0&PageSize=5"],
  ["geofences", "/geofences?FromIndex=0&PageSize=5"],
  ["poicategories", "/poicategories?FromIndex=0&PageSize=5"],
  ["reports", "/reports?FromIndex=0&PageSize=5"],
  ["reporttemplates", "/reporttemplates?FromIndex=0&PageSize=5"],
  ["events (no group)", `/events?Date=${encodeURIComponent(today)}&FromIndex=0&PageSize=5`],
  ["events?groupId=1", `/events?Date=${encodeURIComponent(today)}&groupId=1&FromIndex=0&PageSize=5`],
  ["reversegeocode (smoke)", "/reversegeocode?lat=-6.175392&lon=106.827153"],
];

const results = [];
for (const [label, p] of jobs) {
  const row = await probe(base, token, label, p);
  results.push(row);
  console.log(`${verdict(row).padEnd(10)} ${label} → ${row.status} ${row.kind}`);
}

// If POI categories work, probe first category's pois
const cats = results.find((r) => r.label === "poicategories" && r.ok);
let poiFollow = null;
if (cats) {
  try {
    const res = await armadaFetch(`${base}/poicategories?FromIndex=0&PageSize=5`, {
      headers: { Authorization: token, Accept: "application/json" },
    });
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    const firstId = Number(list[0]?.id ?? list[0]?.categoryId);
    if (Number.isInteger(firstId) && firstId > 0) {
      poiFollow = await probe(base, token, `pois category ${firstId}`, `/poicategories/${firstId}/pois?FromIndex=0&PageSize=5`);
      results.push(poiFollow);
      console.log(`${verdict(poiFollow).padEnd(10)} pois → ${poiFollow.status}`);
    }
  } catch (err) {
    console.log(`ERROR      pois follow-up: ${err instanceof Error ? err.message : err}`);
  }
}

const lines = [
  "# Armada API probe results",
  "",
  `Probed against \`armada.id\` application **${appId}** on **${new Date().toISOString()}**.`,
  "",
  "Auth and tokens are not recorded in this file.",
  "",
  "| Resource | Path | Result | HTTP | Notes |",
  "|----------|------|--------|------|-------|",
];

for (const row of results) {
  const notes = row.ok
    ? row.kind === "array"
      ? `array n=${row.count}`
      : row.itemCount != null
        ? `object keys=${(row.keys || []).join(",")} items=${row.itemCount}`
        : `keys=${(row.keys || []).join(",") || row.kind}`
    : (row.preview || "").replace(/\|/g, "/").slice(0, 80);
  lines.push(
    `| ${row.label} | \`${row.path}\` | **${verdict(row)}** | ${row.status || "—"} | ${notes} |`,
  );
}

lines.push(
  "",
  "## Interpretation (roadmap)",
  "",
  "- **YES** → safe to plan Phase C analytics / Maintenance POI link against this endpoint.",
  "- **DENIED** → token/role missing privilege; fix in Armada before building UI.",
  "- **NO/404** → path not enabled on Armada host or different route; do not depend on it.",
  "- **events?groupId** → if not YES, keep per-user/rule fan-out (current Trip Detail approach).",
  "",
  "## Next",
  "",
  "- Phase C overlays only where Result is YES.",
  "- Maintenance service-point → Armada POI link depends on **poicategories** (+ pois) YES.",
  "",
);

const out = path.join(root, "docs", "armada-api-probe.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${path.relative(root, out)}`);
