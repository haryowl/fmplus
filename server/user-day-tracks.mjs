/**
 * Fan out GpsGate per-vehicle day tracks on the server.
 * Same Filtered=true points as /trackinfos/{id}/tracks, one HTTP call per vehicle-day.
 */
import { armadaFetch } from "./armada-fetch.mjs";
import { tenantAllowsUser, tenantFromRequest } from "./tenants.mjs";

const MAX_DAYS = 320;
/** One POST can take a full 8-vehicle month; the Armada pool is shared. */
const SERVER_CONCURRENCY = 32;
const ATTEMPTS = 3;
const TIMEOUT_MS = 25_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pass Armada's JSON through. Parsing+re-stringifying a full GPS day blocks the event loop. */
export function pointsJson(body) {
  const text = String(body || "").trim();
  if (!text) return "[]";
  if (text[0] === "[") return text;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return text;
    if (Array.isArray(parsed.items)) return JSON.stringify(parsed.items);
  } catch {
    return "[]";
  }
  return "[]";
}

async function mapPool(items, concurrency, worker) {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}

function dayKey(userId, date) {
  return `${userId}|${date}`;
}

async function fetchUserDay(userId, date, auth, appId, signal) {
  const url = `https://armada.id/lt/api/v.1/applications/${appId}/users/${userId}/tracks?Date=${encodeURIComponent(date)}&Filtered=true`;
  let lastError = "request failed";

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const timed = AbortSignal.timeout(TIMEOUT_MS);
      const combined =
        signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timed]) : timed;
      const res = await armadaFetch(url, {
        method: "GET",
        headers: {
          authorization: auth,
          accept: "application/json",
        },
        redirect: "follow",
        signal: combined,
      });
      if (res.status === 404) {
        return "[]";
      }
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        lastError = `Armada ${res.status}`;
        await sleep(Math.min(400 * 2 ** attempt, 8_000));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Armada ${res.status}`);
      }
      return pointsJson(await res.text());
    } catch (err) {
      const name = err?.name || "";
      if ((name === "AbortError" || name === "TimeoutError") && signal?.aborted) throw err;
      lastError = err instanceof Error ? err.message : "network error";
      if (attempt < ATTEMPTS - 1 && !String(lastError).startsWith("Armada ")) {
        await sleep(Math.min(400 * 2 ** attempt, 8_000));
        continue;
      }
      if (String(lastError).startsWith("Armada ") && !/429|502|503|504/.test(lastError)) {
        throw err;
      }
      if (attempt >= ATTEMPTS - 1) throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<boolean>}
 */
export async function handleUserDayTracksRequest(req, res) {
  const pathOnly = (req.url || "").split("?")[0];
  if (pathOnly !== "/api/user-day-tracks") return false;

  const json = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(obj));
  };

  if (req.method !== "POST") {
    json(405, { error: "Method not allowed" });
    return true;
  }

  const tenant = tenantFromRequest(req);
  if (!tenant) {
    json(503, { error: "No tenant token. Set ARMADA_AUTH_HEADER or tenants.json." });
    return true;
  }

  try {
    const payload = await readJsonBody(req, 64 * 1024);
    const rawDays = Array.isArray(payload?.days) ? payload.days : [];
    const days = [];
    const seen = new Set();
    for (const item of rawDays) {
      const userId = Number(item?.userId);
      const date = String(item?.date || "");
      if (!Number.isInteger(userId) || userId < 1) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!tenantAllowsUser(tenant, userId)) {
        json(403, { error: "Vehicle is not allowed for this embed." });
        return true;
      }
      const key = dayKey(userId, date);
      if (seen.has(key)) continue;
      seen.add(key);
      days.push({ userId, date, key });
    }
    if (days.length === 0) {
      json(400, { error: "days required" });
      return true;
    }
    if (days.length > MAX_DAYS) {
      json(400, { error: `at most ${MAX_DAYS} days` });
      return true;
    }

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.once("aborted", onAbort);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    let writeChain = Promise.resolve();
    const writeDay = (key, pointsJsonText, failed) => {
      writeChain = writeChain.then(
        () =>
          new Promise((resolve) => {
            setImmediate(() => {
              if (res.writableEnded) {
                resolve();
                return;
              }
              const line = failed
                ? `{"key":${JSON.stringify(key)},"failed":true}\n`
                : `{"key":${JSON.stringify(key)},"points":${pointsJsonText}}\n`;
              if (res.write(line)) resolve();
              else res.once("drain", resolve);
            });
          }),
      );
    };

    try {
      await mapPool(days, SERVER_CONCURRENCY, async (day) => {
        try {
          const points = await fetchUserDay(day.userId, day.date, tenant.token, tenant.appId, ac.signal);
          writeDay(day.key, points, false);
        } catch (err) {
          if (err?.name === "AbortError" || err?.name === "TimeoutError") {
            if (ac.signal.aborted) throw err;
          }
          writeDay(day.key, "[]", true);
        }
      });
      await writeChain;
      res.end();
    } finally {
      req.off("aborted", onAbort);
    }
  } catch (err) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return true;
    }
    json(err.status || 500, { error: err.message || "User-day track batch failed" });
  }
  return true;
}
