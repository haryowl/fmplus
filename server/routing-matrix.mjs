/**
 * Shared road / straight-line distance matrix for Route plan, Dispatch optimize, CVRP.
 */
import { buildDistanceMatrix } from "./route-optimize.mjs";
import { osrmExcludeQuery, parseRoutingOptions } from "./routing-options.mjs";

async function osrmFetch(url, timeoutMs = 45_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export function osrmBaseUrl(routing = null) {
  const override = routing?.osrmBaseOverride;
  if (override) return String(override).replace(/\/+$/, "");
  const raw = String(process.env.OSRM_BASE_URL || process.env.OSRM_URL || "").trim();
  return raw.replace(/\/+$/, "");
}

/**
 * @param {{ lat: number, lon: number }[]} points
 * @param {import("./routing-options.mjs").RoutingOptions | Record<string, unknown> | null} [routing]
 */
export async function getDistanceMatrix(points, routing = null) {
  const opts = parseRoutingOptions(routing || {});
  if (!Array.isArray(points) || points.length === 0) {
    return { matrixKm: [], durations: null, engine: "haversine", unreachablePairs: 0, routing: opts };
  }
  if (points.length === 1) {
    return {
      matrixKm: [[0]],
      durations: [[0]],
      engine: "haversine",
      unreachablePairs: 0,
      routing: opts,
    };
  }

  const base = osrmBaseUrl(opts);
  if (!base) {
    return {
      matrixKm: buildDistanceMatrix(points),
      durations: null,
      engine: "haversine",
      unreachablePairs: 0,
      routing: opts,
      warning: "OSRM not configured; using straight-line distances",
    };
  }

  const excludeQ = osrmExcludeQuery(opts);
  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `${base}/table/v1/driving/${coords}?annotations=distance,duration${excludeQ}`;
    const res = await osrmFetch(url, 45_000);
    let parsed = null;
    try {
      parsed = res.text ? JSON.parse(res.text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok || !parsed || parsed.code !== "Ok") {
      // Unknown exclude class (graph built without car-fmplus) → retry without ganjil_genap
      const gg = String(process.env.OSRM_GANJIL_GENAP_CLASS || "ganjil_genap").toLowerCase();
      if (excludeQ.includes(gg) && opts.exclude.includes(gg)) {
        const fallbackExclude = opts.exclude.filter((c) => c !== gg);
        const retryOpts = { ...opts, exclude: fallbackExclude };
        const retryQ = osrmExcludeQuery(retryOpts);
        const retryUrl = `${base}/table/v1/driving/${coords}?annotations=distance,duration${retryQ}`;
        const retry = await osrmFetch(retryUrl, 45_000);
        let retryParsed = null;
        try {
          retryParsed = retry.text ? JSON.parse(retry.text) : null;
        } catch {
          retryParsed = null;
        }
        if (retry.ok && retryParsed?.code === "Ok") {
          const distances = retryParsed.distances;
          const durations = retryParsed.durations;
          const matrixKmRaw = distances.map((row) =>
            row.map((m) => (typeof m === "number" && Number.isFinite(m) && m >= 0 ? m / 1000 : null)),
          );
          let unreachablePairs = 0;
          for (let i = 0; i < matrixKmRaw.length; i++) {
            for (let j = 0; j < matrixKmRaw[i].length; j++) {
              if (i !== j && matrixKmRaw[i][j] == null) unreachablePairs += 1;
            }
          }
          const matrixKm = matrixKmRaw.map((row) => row.map((m) => (m == null ? 1e9 : m)));
          return {
            matrixKm,
            durations: Array.isArray(durations) ? durations : null,
            engine: "osrm",
            unreachablePairs,
            routing: retryOpts,
            warning:
              "Ganjil–genap avoid requested but OSRM graph has no ganjil_genap class — rebuild with osrm-profiles/car-fmplus.lua (see docs/osrm.md). Routing without corridor exclude.",
          };
        }
      }
      throw new Error(
        (parsed && (parsed.message || parsed.code)) ||
          res.text.slice(0, 160) ||
          `OSRM table HTTP ${res.status}`,
      );
    }
    const distances = parsed.distances;
    const durations = parsed.durations;
    if (!Array.isArray(distances) || distances.length !== points.length) {
      throw new Error("OSRM table returned unexpected distances");
    }
    const matrixKmRaw = distances.map((row) =>
      row.map((m) => (typeof m === "number" && Number.isFinite(m) && m >= 0 ? m / 1000 : null)),
    );
    let unreachablePairs = 0;
    for (let i = 0; i < matrixKmRaw.length; i++) {
      for (let j = 0; j < matrixKmRaw[i].length; j++) {
        if (i !== j && matrixKmRaw[i][j] == null) unreachablePairs += 1;
      }
    }
    const matrixKm = matrixKmRaw.map((row) => row.map((m) => (m == null ? 1e9 : m)));
    let warning =
      unreachablePairs > 0
        ? `${unreachablePairs} unreachable pair(s) in OSRM table (treated as very long)`
        : undefined;
    if (opts.ganjilGenap?.avoidCorridors && opts.ganjilGenap?.summary) {
      warning = warning
        ? `${warning} · ${opts.ganjilGenap.summary}`
        : opts.ganjilGenap.summary;
    }
    return {
      matrixKm,
      durations: Array.isArray(durations) ? durations : null,
      engine: "osrm",
      unreachablePairs,
      routing: opts,
      warning,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      matrixKm: buildDistanceMatrix(points),
      durations: null,
      engine: "haversine",
      unreachablePairs: 0,
      routing: opts,
      warning: `OSRM table failed (${msg}); using straight-line distances`,
    };
  }
}
