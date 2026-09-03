/**
 * Native fetch queues on a small per-host pool, so raising mapPool
 * concurrency did not open more Armada sockets. A dedicated https.Agent
 * does. No undici package — VPS Node does not ship `node:undici`.
 */
import https from "node:https";

const TIMEOUT_MS = 25_000;

const armadaAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 48,
  maxFreeSockets: 24,
  timeout: TIMEOUT_MS,
});

export function armadaFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = { ...(options.headers || {}) };
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || "GET",
        headers,
        agent: armadaAgent,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const status = res.statusCode || 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            buffer,
            retryAfter: res.headers["retry-after"] || null,
            async text() {
              return buffer.toString("utf8");
            },
            async json() {
              return JSON.parse(buffer.toString("utf8") || "null");
            },
          });
        });
      },
    );

    const fail = (err) => {
      if (req.destroyed) return;
      req.destroy();
      reject(err);
    };

    req.on("error", reject);
    req.on("timeout", () => {
      fail(Object.assign(new Error("Armada timeout"), { name: "TimeoutError" }));
    });

    const signal = options.signal;
    if (signal) {
      const onAbort = () => {
        fail(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
    }

    req.end();
  });
}
