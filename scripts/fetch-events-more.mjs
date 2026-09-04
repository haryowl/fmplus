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
          res({ status: x.statusCode, j, bytes: b.length });
        });
      },
    );
    r.on("error", rej);
    r.end();
  });
}

const tries = [
  "/events?Date=2026-08-31&userId=1861",
  "/events?Date=2026-09-03&userId=1859",
  "/events?Date=2026-09-04&userId=1859",
  "/events?Date=2026-08-26&userId=1861",
  "/eventrules",
];

for (const p of tries) {
  const r = await get(p);
  const n = Array.isArray(r.j) ? r.j.length : Array.isArray(r.j?.items) ? r.j.items.length : null;
  console.log(r.status, p, `count=${n}`, `bytes=${r.bytes}`);
  if (Array.isArray(r.j) && r.j.length) console.log(JSON.stringify(r.j.slice(0, 2), null, 2));
  if (p === "/eventrules") {
    console.log(r.j.map((x) => ({ id: x.id, name: x.name, disabled: x.disabled })));
  }
}
