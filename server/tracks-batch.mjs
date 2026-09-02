/**
 * Browser HTTP/1.1 only opens a handful of connections to this host.
 * This endpoint fans out many Armada track downloads on the server instead.
 */
import { tenantFromRequest } from "./tenants.mjs";

const MAX_IDS = 32;
const SERVER_CONCURRENCY = 12;
const ATTEMPTS = 6;
const TIMEOUT_MS = 120_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrap(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) return raw.items;
  return [];
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

async function fetchOneTrack(id, auth, appId, signal) {
  const url = `https://armada.id/lt/api/v.1/applications/${appId}/trackinfos/${id}/tracks?Filtered=true`;
  let lastError = "request failed";

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const timed = AbortSignal.timeout(TIMEOUT_MS);
      const combined =
        signal && typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timed]) : timed;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          authorization: auth,
          accept: "application/json",
        },
        redirect: "follow",
        signal: combined,
      });
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        lastError = `Armada ${res.status}`;
        await sleep(Math.min(400 * 2 ** attempt, 12_000));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Armada ${res.status}`);
      }
      return unwrap(await res.json());
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastError = err instanceof Error ? err.message : "network error";
      if (attempt < ATTEMPTS - 1 && !String(lastError).startsWith("Armada ")) {
        await sleep(Math.min(400 * 2 ** attempt, 12_000));
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
export async function handleTracksBatchRequest(req, res) {
  const pathOnly = (req.url || "").split("?")[0];
  if (pathOnly !== "/api/tracks-batch") return false;

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
    const payload = await readJsonBody(req, 16 * 1024);
    const rawIds = Array.isArray(payload?.ids) ? payload.ids : [];
    const ids = [...new Set(rawIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) {
      json(400, { error: "ids required" });
      return true;
    }
    if (ids.length > MAX_IDS) {
      json(400, { error: `at most ${MAX_IDS} ids` });
      return true;
    }

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    req.once("aborted", onAbort);

    const byId = {};
    const failed = [];
    try {
      await mapPool(ids, SERVER_CONCURRENCY, async (id) => {
        try {
          byId[String(id)] = await fetchOneTrack(id, tenant.token, tenant.appId, ac.signal);
        } catch (err) {
          if (err?.name === "AbortError") throw err;
          failed.push(id);
        }
      });
    } finally {
      req.off("aborted", onAbort);
    }

    json(200, { byId, failed });
  } catch (err) {
    json(err.status || 500, { error: err.message || "Track batch failed" });
  }
  return true;
}
