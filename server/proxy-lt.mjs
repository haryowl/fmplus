import {
  applicationIdFromLtUrl,
  defaultFrameAncestors,
  filterArmadaList,
  listFilterKind,
  restPathFromLtUrl,
  tenantAllowsGroup,
  tenantAllowsUser,
  tenantFromRequest,
} from "./tenants.mjs";

const PROXY_ATTEMPTS = 6;
const PROXY_TIMEOUT_MS = 120_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function proxyRetryDelayMs(attempt, retryAfter) {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 20_000);
    }
  }
  return Math.min(400 * 2 ** attempt, 12_000);
}

function isRetryableUpstream(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": `frame-ancestors ${defaultFrameAncestors()}`,
    "Cache-Control": extra["Cache-Control"] || "no-store",
    ...extra,
  };
}

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function forbiddenUserOrGroup(tenant, restPath) {
  const pathOnly = (restPath || "/").split("?")[0];
  const user = /^\/users\/(\d+)(?:\/|$)/.exec(pathOnly);
  if (user && !tenantAllowsUser(tenant, user[1])) return true;
  const group = /^\/groups\/(\d+)(?:\/|$)/.exec(pathOnly);
  if (group && !tenantAllowsGroup(tenant, group[1])) return true;
  return false;
}

export async function proxyLt(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, { "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed");
    return;
  }

  const tenant = tenantFromRequest(req);
  if (!tenant) {
    send(
      res,
      503,
      { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({ error: "No tenant token. Set ARMADA_AUTH_HEADER or tenants.json." }),
    );
    return;
  }

  const appId = applicationIdFromLtUrl(req.url || "");
  if (appId === null || appId !== tenant.appId) {
    send(
      res,
      403,
      { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({ error: "Application does not match this embed tenant." }),
    );
    return;
  }

  const restPath = restPathFromLtUrl(req.url || "");
  if (forbiddenUserOrGroup(tenant, restPath)) {
    send(
      res,
      403,
      { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({ error: "Vehicle or group is not allowed for this embed." }),
    );
    return;
  }

  const filterKind = listFilterKind(restPath);
  const url = `https://armada.id${req.url}`;
  let lastError = "Armada proxy failed";

  for (let attempt = 0; attempt < PROXY_ATTEMPTS; attempt += 1) {
    if (req.aborted || res.writableEnded) return;
    try {
      const upstream = await fetch(url, {
        method: "GET",
        headers: {
          authorization: tenant.token,
          accept: req.headers.accept || "application/json",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });

      if (isRetryableUpstream(upstream.status) && attempt < PROXY_ATTEMPTS - 1) {
        await upstream.body?.cancel?.();
        await sleep(proxyRetryDelayMs(attempt, upstream.headers.get("retry-after")));
        continue;
      }

      const headers = {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      };
      const retryAfter = upstream.headers.get("retry-after");
      if (retryAfter) headers["Retry-After"] = retryAfter;

      if (filterKind && tenant.userIds.length + tenant.groupIds.length > 0 && upstream.ok) {
        let raw = null;
        try {
          raw = JSON.parse(Buffer.from(await upstream.arrayBuffer()).toString("utf8") || "null");
        } catch {
          send(res, 502, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ error: "Invalid Armada list" }));
          return;
        }
        send(res, upstream.status, headers, JSON.stringify(filterArmadaList(raw, tenant, filterKind)));
        return;
      }

      res.writeHead(upstream.status, securityHeaders(headers));
      if (req.method === "HEAD" || !upstream.body) {
        res.end();
        return;
      }

      const onAbort = () => {
        upstream.body.cancel().catch(() => {});
      };
      req.once("aborted", onAbort);
      try {
        for await (const chunk of upstream.body) {
          if (req.aborted || res.writableEnded) break;
          if (!res.write(chunk)) {
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
      } finally {
        req.off("aborted", onAbort);
      }
      if (!res.writableEnded) res.end();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Armada proxy failed";
      if (attempt < PROXY_ATTEMPTS - 1) {
        await sleep(proxyRetryDelayMs(attempt, null));
        continue;
      }
    }
  }

  if (!res.headersSent) {
    send(
      res,
      502,
      { "Content-Type": "application/json; charset=utf-8" },
      JSON.stringify({ error: lastError }),
    );
  } else if (!res.writableEnded) {
    res.end();
  }
}

export async function handleLtProxyRequest(req, res) {
  const urlPath = req.url || "/";
  if (urlPath !== "/lt" && !urlPath.startsWith("/lt/")) return false;
  await proxyLt(req, res);
  return true;
}
