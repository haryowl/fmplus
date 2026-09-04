import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 1) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}
const auth = env.ARMADA_AUTH_HEADER;
const app = env.ARMADA_APP_ID || 36;

function get(p) {
  return new Promise((res, rej) => {
    const u = new URL(`https://armada.id/lt/api/v.1/applications/${app}${p}`);
    const r = https.request(
      {
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { authorization: auth, accept: "application/json" },
        timeout: 60_000,
      },
      (x) => {
        const c = [];
        x.on("data", (d) => c.push(d));
        x.on("end", () => {
          const b = Buffer.concat(c).toString("utf8");
          let j = null;
          try {
            j = JSON.parse(b || "null");
          } catch {
            j = b;
          }
          res({ status: x.statusCode, j, bytes: b.length, text: b.slice(0, 500) });
        });
      },
    );
    r.on("error", rej);
    r.end();
  });
}

const userId = 1859;
const date = "2026-08-15";
const paths = [
  `/events?Date=${date}&userId=${userId}&eventRuleId=436`,
  `/events?Date=${date}&userId=${userId}&EventRuleId=436`,
  `/events?Date=${date}&userId=${userId}&ruleId=436`,
  `/events?Date=${date}&userId=${userId}&Take=500`,
  `/events?date=${date}&userId=${userId}`,
  `/eventexpressions`,
  `/EventExpressions`,
  `/eventExpressions`,
  `/users/${userId}/eventexpressions`,
  `/reports`,
  `/Reports`,
  `/users/${userId}/reports`,
  `/events/search?Date=${date}&userId=${userId}`,
  `/eventrule/${436}/events?Date=${date}&userId=${userId}`,
  `/eventrules/436/events?Date=${date}&userId=${userId}`,
  `/eventrules/436`,
  `/events?Date=${date}&userId=${userId}&IncludeDisabled=true`,
];

for (const p of paths) {
  const r = await get(p);
  const n = Array.isArray(r.j) ? r.j.length : Array.isArray(r.j?.items) ? r.j.items.length : null;
  console.log(`${r.status}\tcount=${n}\t${p}`);
  if (r.status === 200 && n !== 0 && n !== null) {
    console.log(JSON.stringify(Array.isArray(r.j) ? r.j.slice(0, 2) : r.j, null, 2).slice(0, 1500));
  } else if (r.status !== 200 && r.status !== 404) {
    console.log(" ", r.text);
  } else if (r.status === 200 && r.j && !Array.isArray(r.j)) {
    console.log(" ", JSON.stringify(r.j).slice(0, 400));
  }
}
