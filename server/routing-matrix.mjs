/**
 * Shared road / straight-line distance matrix for Route plan, Dispatch optimize, CVRP.
 */
import { buildDistanceMatrix } from "./route-optimize.mjs";

async function osrmFetch(url, timeoutMs = 45_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export function osrmBaseUrl() {
  const raw = String(process.env.OSRM_BASE_URL || process.env.OSRM_URL || "").trim();
  return raw.replace(/\/+$/, "");
}

/**
 * @param {{ lat: number, lon: number }[]} points
 * @returns {Promise<{
 *   matrixKm: number[][],
 *   durations: number[][] | null,
 *   engine: "osrm" | "haversine",
 *   unreachablePairs: number,
 *   warning?: string,
 * }>}
 */
export async function getDistanceMatrix(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { matrixKm: [], durations: null, engine: "haversine", unreachablePairs: 0 };
  }
  if (points.length === 1) {
    return { matrixKm: [[0]], durations: [[0]], engine: "haversine", unreachablePairs: 0 };
  }

  const base = osrmBaseUrl();
  if (!base) {
    return {
      matrixKm: buildDistanceMatrix(points),
      durations: null,
      engine: "haversine",
      unreachablePairs: 0,
      warning: "OSRM not configured; using straight-line distances",
    };
  }

  try {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
    const url = `${base}/table/v1/driving/${coords}?annotations=distance,duration`;
    const res = await osrmFetch(url, 45_000);
    let parsed = null;
    try {
      parsed = res.text ? JSON.parse(res.text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok || !parsed || parsed.code !== "Ok") {
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
    return {
      matrixKm,
      durations: Array.isArray(durations) ? durations : null,
      engine: "osrm",
      unreachablePairs,
      warning:
        unreachablePairs > 0
          ? `${unreachablePairs} unreachable pair(s) in OSRM table (treated as very long)`
          : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      matrixKm: buildDistanceMatrix(points),
      durations: null,
      engine: "haversine",
      unreachablePairs: 0,
      warning: `OSRM table failed (${msg}); using straight-line distances`,
    };
  }
}
