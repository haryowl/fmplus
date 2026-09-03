/**
 * Fan out GpsGate per-vehicle day tracks on the server.
 * Same Filtered=true points as /trackinfos/{id}/tracks, one HTTP call per vehicle-day.
 */
import { armadaFetch } from "./armada-fetch.mjs";
import { RECOVER_SUCCESS_STREAK, reducedCapOn429, isRetryableArmadaStatus, planArmadaRetry } from "./armada-retry.mjs";
import { slimAsync } from "./slim-pool.mjs";
import { tenantAllowsUser, tenantFromRequest } from "./tenants.mjs";

const MAX_DAYS = 320;
const START_CAP = 6;
const MIN_CAP = 2;
const MAX_CAP = 8;
const PER_DAY_ATTEMPTS = 40;
const TIMEOUT_MS = 25_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dayKey(userId, date) {
  return `${userId}|${date}`;
}

function abortError() {
  return Object.assign(new Error("Aborted"), { name: "AbortError" });
}

async function fetchUserDayOnce(userId, date, auth, appId, signal) {
  const url = `https://armada.id/lt/api/v.1/applications/${appId}/users/${userId}/tracks?Date=${encodeURIComponent(date)}&Filtered=true`;
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
  if (res.status === 404) return { raw: "" };
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error(`Armada ${res.status}`), { fatal: true });
  }
  if (isRetryableArmadaStatus(res.status)) {
    return { retry: true, retryAfter: res.retryAfter, status: res.status };
  }
  if (!res.ok) {
    throw new Error(`Armada ${res.status}`);
  }
  return { raw: res.buffer || (await res.text()) };
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
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const started = Date.now();
    console.log(`[user-day-tracks] start ${days.length} days cap=${START_CAP}`);

    let writeChain = Promise.resolve();
    let pending = "";
    let flushTimer = null;
    const flushWrites = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pending || res.writableEnded) {
        pending = "";
        return;
      }
      const chunk = pending;
      pending = "";
      writeChain = writeChain.then(
        () =>
          new Promise((resolve) => {
            if (res.writableEnded) {
              resolve();
              return;
            }
            if (res.write(chunk)) resolve();
            else res.once("drain", resolve);
          }),
      );
    };
    const writeDay = (key, pointsJsonText, failed) => {
      pending += failed
        ? `{"key":${JSON.stringify(key)},"failed":true}\n`
        : `{"key":${JSON.stringify(key)},"points":${pointsJsonText}}\n`;
      if (pending.length >= 48_000) flushWrites();
      else if (!flushTimer) flushTimer = setTimeout(flushWrites, 8);
    };

    try {
      const slimJobs = [];
      const queueSlim = (day, raw) => {
        slimJobs.push(
          slimAsync(raw).then(
            (text) => writeDay(day.key, text, false),
            () => writeDay(day.key, "[]", false),
          ),
        );
      };

      // Failed days go to the tail. Only 429 pauses every worker.
      const queue = days.map((day) => ({ ...day, attempts: 0 }));
      let remaining = days.length;
      let cap = START_CAP;
      let active = 0;
      let cooldownUntil = 0;
      let successStreak = 0;

      const waitCooldown = async () => {
        for (;;) {
          if (ac.signal.aborted) throw abortError();
          const wait = cooldownUntil - Date.now();
          if (wait <= 0) return;
          await sleep(Math.min(wait, 200));
        }
      };

      const acquire = async () => {
        for (;;) {
          if (ac.signal.aborted) throw abortError();
          await waitCooldown();
          if (active < cap) {
            active += 1;
            return;
          }
          await sleep(40);
        }
      };

      const worker = async () => {
        for (;;) {
          if (remaining === 0) return;
          if (ac.signal.aborted) throw abortError();
          const day = queue.shift();
          if (!day) {
            await sleep(40);
            continue;
          }
          await acquire();
          try {
            day.attempts += 1;
            let outcome;
            try {
              outcome = await fetchUserDayOnce(day.userId, day.date, tenant.token, tenant.appId, ac.signal);
            } catch (err) {
              if (err?.fatal || ac.signal.aborted) throw err;
              const name = err?.name || "";
              if (name === "AbortError" && ac.signal.aborted) throw err;
              outcome = { retry: true, retryAfter: null, status: 0 };
            }
            if (outcome.retry) {
              const plan = planArmadaRetry(outcome.status, outcome.retryAfter, day.attempts);
              if (plan.dropCap) {
                cap = Math.max(MIN_CAP, reducedCapOn429(cap));
                successStreak = 0;
              }
              if (plan.cooldownMs > 0) {
                cooldownUntil = Math.max(cooldownUntil, Date.now() + plan.cooldownMs);
              }
              if (day.attempts < PER_DAY_ATTEMPTS) queue.push(day);
              else {
                remaining -= 1;
                writeDay(day.key, "[]", true);
                console.log(`[user-day-tracks] gave up ${day.key} after ${day.attempts} attempts`);
              }
            } else {
              remaining -= 1;
              successStreak += 1;
              if (successStreak >= RECOVER_SUCCESS_STREAK && cap < MAX_CAP) {
                cap += 1;
                successStreak = 0;
              }
              queueSlim(day, outcome.raw);
            }
          } finally {
            active -= 1;
          }
        }
      };

      await Promise.all(Array.from({ length: MAX_CAP }, () => worker()));
      await Promise.all(slimJobs);
      flushWrites();
      await writeChain;
      res.end();
      console.log(`[user-day-tracks] done ${days.length} days in ${Date.now() - started}ms`);
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
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
