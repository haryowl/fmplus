/**
 * Phase E — Route plan API
 * GET  /api/route-plan/status
 * POST /api/route-plan/optimize  { start, stops[], roundtrip? }
 *
 * Uses OSRM when OSRM_BASE_URL is set; otherwise haversine + 2-opt TSP.
 */
import { securityHeaders } from "./proxy-lt.mjs";
import { armadaFetch } from "./armada-fetch.mjs";
import { haversineKm, optimizeOpenTour } from "./route-optimize.mjs";

const MAX_STOPS = 25;

function send(res, status, headers, body) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

function json(res, status, obj) {
  send(
    res,
    status,
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    JSON.stringify(obj),
  );
}

function readBody(req, limit = 256_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function osrmBase() {
  const raw = String(process.env.OSRM_BASE_URL || process.env.OSRM_URL || "").trim();
  return raw.replace(/\/+$/, "");
}

function asPoint(raw, fallbackLabel) {
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon ?? raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const label = String(raw.label || raw.name || fallbackLabel || "").trim();
  const id = raw.id != null ? String(raw.id) : undefined;
  return { lat, lon, label: label || fallbackLabel || "", id };
}

function straightGeometry(ordered) {
  return ordered.map((p) => [p.lat, p.lon]);
}

async function osrmTable(base, points) {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${base}/table/v1/driving/${coords}?annotations=distance,duration`;
  const res = await armadaFetch(url, { timeoutMs: 45_000 });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok || !parsed || parsed.code !== "Ok") {
    throw new Error(
      (parsed && (parsed.message || parsed.code)) || text.slice(0, 160) || `OSRM table HTTP ${res.status}`,
    );
  }
  const distances = parsed.distances;
  const durations = parsed.durations;
  if (!Array.isArray(distances) || distances.length !== points.length) {
    throw new Error("OSRM table returned unexpected distances");
  }
  // Convert meters → km for optimizeOpenTour
  const matrixKm = distances.map((row) => row.map((m) => (typeof m === "number" && m >= 0 ? m / 1000 : 1e9)));
  return { matrixKm, durations };
}

async function osrmRoute(base, ordered) {
  const coords = ordered.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await armadaFetch(url, { timeoutMs: 45_000 });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok || !parsed || parsed.code !== "Ok" || !parsed.routes?.[0]) {
    throw new Error(
      (parsed && (parsed.message || parsed.code)) || text.slice(0, 160) || `OSRM route HTTP ${res.status}`,
    );
  }
  const route = parsed.routes[0];
  const coordsLatLon = (route.geometry?.coordinates || []).map(([lon, lat]) => [lat, lon]);
  return {
    geometry: coordsLatLon,
    distanceKm: Number(route.distance) / 1000,
    durationSec: Number(route.duration),
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleRoutePlanRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/route-plan")) return false;

  try {
    if (url.pathname === "/api/route-plan/status" && req.method === "GET") {
      const base = osrmBase();
      json(res, 200, {
        osrmConfigured: Boolean(base),
        osrmBase: base ? "(configured)" : "",
        maxStops: MAX_STOPS,
        engines: base ? ["osrm", "haversine"] : ["haversine"],
      });
      return true;
    }

    if (url.pathname === "/api/route-plan/optimize" && req.method === "POST") {
      const body = await readJson(req);
      const start = asPoint(body.start, "Start");
      if (!start) {
        json(res, 400, { error: "start { lat, lon } is required" });
        return true;
      }
      const stopRaw = Array.isArray(body.stops) ? body.stops : [];
      if (!stopRaw.length) {
        json(res, 400, { error: "At least one stop is required" });
        return true;
      }
      if (stopRaw.length > MAX_STOPS) {
        json(res, 400, { error: `At most ${MAX_STOPS} stops` });
        return true;
      }
      const stops = [];
      for (let i = 0; i < stopRaw.length; i++) {
        const p = asPoint(stopRaw[i], `Stop ${i + 1}`);
        if (!p) {
          json(res, 400, { error: `Invalid stop at index ${i}` });
          return true;
        }
        stops.push(p);
      }
      const roundtrip = Boolean(body.roundtrip);
      const points = [start, ...stops];

      const base = osrmBase();
      let engine = "haversine";
      let orderIdx = [];
      let distanceKm = 0;
      let durationSec = null;
      let geometry = [];
      let warning = "";

      if (base) {
        try {
          const { matrixKm, durations } = await osrmTable(base, points);
          const opt = optimizeOpenTour(points, matrixKm);
          orderIdx = opt.order;
          let ordered = orderIdx.map((i) => points[i]);
          if (roundtrip) ordered = [...ordered, { ...start, label: `${start.label || "Start"} (return)`, id: "return" }];
          try {
            const routed = await osrmRoute(base, ordered);
            geometry = routed.geometry;
            distanceKm = routed.distanceKm;
            durationSec = routed.durationSec;
          } catch {
            geometry = straightGeometry(ordered);
            distanceKm = opt.distance;
            if (roundtrip) {
              const last = ordered[ordered.length - 2];
              distanceKm += haversineKm(last.lat, last.lon, start.lat, start.lon);
            }
            let dur = 0;
            let okDur = true;
            for (let i = 0; i < orderIdx.length - 1; i++) {
              const a = orderIdx[i];
              const b = orderIdx[i + 1];
              const d = durations?.[a]?.[b];
              if (typeof d !== "number" || d < 0) {
                okDur = false;
                break;
              }
              dur += d;
            }
            if (okDur && roundtrip) {
              const lastIdx = orderIdx[orderIdx.length - 1];
              const d = durations?.[lastIdx]?.[0];
              if (typeof d === "number" && d >= 0) dur += d;
              else okDur = false;
            }
            durationSec = okDur ? dur : null;
            warning = "OSRM table OK; route geometry fallback to straight segments";
          }
          engine = "osrm";
        } catch (err) {
          warning = `OSRM unavailable (${err instanceof Error ? err.message : String(err)}); using haversine`;
          const opt = optimizeOpenTour(points);
          orderIdx = opt.order;
          let ordered = orderIdx.map((i) => points[i]);
          if (roundtrip) {
            ordered = [...ordered, { ...start, label: `${start.label || "Start"} (return)`, id: "return" }];
            distanceKm = opt.distance + haversineKm(ordered[ordered.length - 2].lat, ordered[ordered.length - 2].lon, start.lat, start.lon);
          } else {
            distanceKm = opt.distance;
          }
          geometry = straightGeometry(ordered);
          engine = "haversine";
        }
      } else {
        const opt = optimizeOpenTour(points);
        orderIdx = opt.order;
        let ordered = orderIdx.map((i) => points[i]);
        if (roundtrip) {
          ordered = [...ordered, { ...start, label: `${start.label || "Start"} (return)`, id: "return" }];
          distanceKm =
            opt.distance +
            haversineKm(ordered[ordered.length - 2].lat, ordered[ordered.length - 2].lon, start.lat, start.lon);
        } else {
          distanceKm = opt.distance;
        }
        geometry = straightGeometry(ordered);
        engine = "haversine";
        warning = "Set OSRM_BASE_URL for road distances; using straight-line estimate";
      }

      let orderedStops = orderIdx.map((i, seq) => ({
        seq,
        ...points[i],
        role: i === 0 ? "start" : "stop",
      }));
      if (roundtrip) {
        orderedStops = [
          ...orderedStops,
          {
            seq: orderedStops.length,
            ...start,
            label: `${start.label || "Start"} (return)`,
            id: "return",
            role: "return",
          },
        ];
      }

      // Leg distances for Excel
      const legs = [];
      for (let i = 0; i < orderedStops.length - 1; i++) {
        const a = orderedStops[i];
        const b = orderedStops[i + 1];
        legs.push({
          from: a.label || `Point ${i}`,
          to: b.label || `Point ${i + 1}`,
          distanceKm: Math.round(haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000) / 1000,
        });
      }

      json(res, 200, {
        engine,
        warning: warning || null,
        roundtrip,
        totalDistanceKm: Math.round(distanceKm * 1000) / 1000,
        totalDurationSec: durationSec == null ? null : Math.round(durationSec),
        orderedStops,
        legs,
        geometry,
      });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[route-plan]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
