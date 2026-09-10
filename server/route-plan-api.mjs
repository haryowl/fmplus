/**
 * Phase E — Route plan API
 * GET  /api/route-plan/status
 * POST /api/route-plan/optimize  { start, stops[], roundtrip? }
 * POST /api/route-plan/geometry { points: [{lat,lon},...] } — road path for an ordered tour
 *
 * Uses OSRM when OSRM_BASE_URL is set; otherwise haversine + 2-opt TSP.
 */
import { securityHeaders } from "./proxy-lt.mjs";
import { haversineKm, optimizeOpenTour } from "./route-optimize.mjs";

const MAX_STOPS = 25;

/** Local OSRM is usually http://127.0.0.1 — do not use armadaFetch (HTTPS-only). */
async function osrmFetch(url, timeoutMs = 45_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

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

function pathDistanceHaversine(ordered) {
  let sum = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    sum += haversineKm(ordered[i].lat, ordered[i].lon, ordered[i + 1].lat, ordered[i + 1].lon);
  }
  return Math.round(sum * 100) / 100;
}

function straightGeometry(ordered) {
  return ordered.map((p) => [p.lat, p.lon]);
}

async function osrmTable(base, points) {
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
      (parsed && (parsed.message || parsed.code)) || res.text.slice(0, 160) || `OSRM table HTTP ${res.status}`,
    );
  }
  const distances = parsed.distances;
  const durations = parsed.durations;
  if (!Array.isArray(distances) || distances.length !== points.length) {
    throw new Error("OSRM table returned unexpected distances");
  }
  // Convert meters → km for optimizeOpenTour. null = unreachable / outside extract.
  const matrixKm = distances.map((row) =>
    row.map((m) => (typeof m === "number" && Number.isFinite(m) && m >= 0 ? m / 1000 : null)),
  );
  const unreachablePairs = matrixKm.reduce((n, row, i) => {
    for (let j = 0; j < row.length; j++) {
      if (i !== j && row[j] == null) n += 1;
    }
    return n;
  }, 0);
  // TSP needs finite costs; treat unreachable as huge so we can still order, then warn.
  const matrixForOpt = matrixKm.map((row) => row.map((m) => (m == null ? 1e9 : m)));
  return { matrixKm: matrixForOpt, durations, unreachablePairs };
}

function decodeOsrmPolyline(encoded, precision = 5) {
  if (!encoded || typeof encoded !== "string") return [];
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = 10 ** precision;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += dlon;
    coordinates.push([lat / factor, lon / factor]);
  }
  return coordinates;
}

function geometryFromOsrmRoute(route) {
  const g = route?.geometry;
  if (!g) return [];
  if (typeof g === "string") return decodeOsrmPolyline(g);
  if (Array.isArray(g.coordinates)) {
    const out = [];
    for (const c of g.coordinates) {
      if (!Array.isArray(c) || c.length < 2) continue;
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push([lat, lon]);
    }
    return out;
  }
  return [];
}

/**
 * Primary path — identical to the pre-regression Route plan call
 * (no radiuses; geojson overview=full).
 */
async function osrmRoute(base, ordered) {
  const coords = ordered.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const res = await osrmFetch(url, 45_000);
  let parsed = null;
  try {
    parsed = res.text ? JSON.parse(res.text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok || !parsed || parsed.code !== "Ok" || !parsed.routes?.[0]) {
    throw new Error(
      (parsed && (parsed.message || parsed.code)) || res.text.slice(0, 160) || `OSRM route HTTP ${res.status}`,
    );
  }
  const route = parsed.routes[0];
  let coordsLatLon = geometryFromOsrmRoute(route);
  // Legacy parse if geometry object shape differs
  if (coordsLatLon.length < 2 && Array.isArray(route.geometry?.coordinates)) {
    coordsLatLon = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  }
  const legs = Array.isArray(route.legs)
    ? route.legs.map((leg) => ({
        distanceKm: Math.round((Number(leg.distance) / 1000) * 100) / 100,
        durationSec: Math.round(Number(leg.duration) || 0),
      }))
    : [];
  return {
    geometry: coordsLatLon,
    distanceKm: Math.round((Number(route.distance) / 1000) * 100) / 100,
    durationSec: Math.round(Number(route.duration) || 0),
    legs,
  };
}

/** ~urban/intercity mix when OSRM is unavailable. */
const HAV_SPEED_KMH = 35;

function haversineRoute(points) {
  const legs = [];
  let totalKm = 0;
  let totalSec = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const km = haversineKm(points[i].lat, points[i].lon, points[i + 1].lat, points[i + 1].lon);
    const durationSec = Math.max(60, Math.round((km / HAV_SPEED_KMH) * 3600));
    legs.push({
      distanceKm: Math.round(km * 100) / 100,
      durationSec,
    });
    totalKm += km;
    totalSec += durationSec;
  }
  return {
    geometry: straightGeometry(points),
    distanceKm: Math.round(totalKm * 100) / 100,
    durationSec: totalSec,
    legs,
  };
}

/** Ordered waypoints → road geometry + per-leg stats (OSRM when available). */
export async function buildRouteForPoints(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return {
      engine: "haversine",
      geometry: [],
      legs: [],
      distanceKm: 0,
      durationSec: 0,
      warning: "Need at least 2 points",
    };
  }
  const normalized = points.map((p) => ({
    lat: Number(p.lat),
    lon: Number(p.lon ?? p.lng),
  }));
  if (normalized.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon))) {
    return {
      engine: "haversine",
      geometry: [],
      legs: [],
      distanceKm: 0,
      durationSec: 0,
      warning: "Invalid coordinates",
    };
  }

  const fallback = haversineRoute(normalized);
  const base = osrmBase();
  if (!base) {
    return {
      engine: "haversine",
      ...fallback,
      warning: "OSRM not configured (set OSRM_BASE_URL)",
    };
  }

  try {
    const routed = await osrmRoute(base, normalized);
    const osrmUseless =
      !Number.isFinite(routed.distanceKm) ||
      routed.distanceKm <= 0 ||
      !Array.isArray(routed.geometry) ||
      routed.geometry.length < 2;
    if (osrmUseless) {
      return {
        engine: "haversine",
        ...fallback,
        warning:
          "OSRM returned an empty/zero route (check extract coverage); using straight-line estimate",
      };
    }
    const legsAllZero =
      !routed.legs.length ||
      routed.legs.every((l) => !l.distanceKm && !l.durationSec);
    return {
      engine: "osrm",
      geometry: routed.geometry,
      legs:
        !legsAllZero && routed.legs.length === normalized.length - 1
          ? routed.legs
          : fallback.legs,
      distanceKm: routed.distanceKm,
      durationSec: routed.durationSec > 0 ? routed.durationSec : fallback.durationSec,
      warning: legsAllZero ? "OSRM path OK but leg times missing; estimated from distance" : null,
    };
  } catch (err) {
    return {
      engine: "haversine",
      ...fallback,
      warning: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeOsrm(base) {
  const url = `${base}/route/v1/driving/106.8272,-6.1754;106.8456,-6.2088?overview=false`;
  try {
    const res = await osrmFetch(url, 8_000);
    let parsed = null;
    try {
      parsed = res.text ? JSON.parse(res.text) : null;
    } catch {
      parsed = null;
    }
    return {
      reachable: res.ok && parsed?.code === "Ok",
      status: res.status,
      error: res.ok && parsed?.code === "Ok" ? null : res.text.slice(0, 160) || `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      reachable: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
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
      const probe = base ? await probeOsrm(base) : null;
      json(res, 200, {
        osrmConfigured: Boolean(base),
        osrmReachable: probe ? probe.reachable : false,
        osrmError: probe && !probe.reachable ? probe.error : null,
        osrmBase: base ? "(configured)" : "",
        maxStops: MAX_STOPS,
        engines: base && probe?.reachable ? ["osrm", "haversine"] : ["haversine"],
      });
      return true;
    }

    if (url.pathname === "/api/route-plan/geometry" && req.method === "POST") {
      const body = await readJson(req);
      const rawPoints = Array.isArray(body.points) ? body.points : [];
      if (rawPoints.length < 2) {
        json(res, 400, { error: "At least 2 points required" });
        return true;
      }
      if (rawPoints.length > MAX_STOPS + 1) {
        json(res, 400, { error: `At most ${MAX_STOPS + 1} points` });
        return true;
      }
      const points = [];
      for (let i = 0; i < rawPoints.length; i++) {
        const p = asPoint(rawPoints[i], `P${i + 1}`);
        if (!p) {
          json(res, 400, { error: `Invalid point at index ${i}` });
          return true;
        }
        points.push(p);
      }

      const routed = await buildRouteForPoints(points);
      json(res, 200, routed);
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
      const preserveOrder = Boolean(body.preserveOrder);
      const points = [start, ...stops];

      const base = osrmBase();
      let engine = "haversine";
      let orderIdx = [];
      let distanceKm = 0;
      let durationSec = null;
      let geometry = [];
      let warning = "";
      let routeLegs = [];

      if (base) {
        try {
          const { matrixKm, durations, unreachablePairs } = await osrmTable(base, points);
          let ordered;
          if (preserveOrder) {
            orderIdx = points.map((_, i) => i);
            ordered = points.slice();
          } else {
            const opt = optimizeOpenTour(points, matrixKm);
            orderIdx = opt.order;
            ordered = orderIdx.map((i) => points[i]);
          }
          if (roundtrip) ordered = [...ordered, { ...start, label: `${start.label || "Start"} (return)`, id: "return" }];

          if (unreachablePairs > 0) {
            // Points outside the built OSM extract (e.g. Sulawesi on a Java-only graph).
            if (!preserveOrder) {
              const haver = optimizeOpenTour(points);
              orderIdx = haver.order;
              ordered = orderIdx.map((i) => points[i]);
            } else {
              orderIdx = points.map((_, i) => i);
              ordered = points.slice();
            }
            if (roundtrip) {
              ordered = [...ordered, { ...start, label: `${start.label || "Start"} (return)`, id: "return" }];
            }
            distanceKm = pathDistanceHaversine(ordered);
            geometry = straightGeometry(ordered);
            durationSec = null;
            engine = "haversine";
            routeLegs = haversineRoute(ordered).legs;
            warning =
              "OSRM has no road path for these coordinates (outside the map extract). Showing straight-line only. Rebuild with ./scripts/setup-osrm.sh --regions=java,sumatra,kalimantan,sulawesi (or indonesia-latest).";
          } else {
            try {
              const routed = await osrmRoute(base, ordered);
              geometry = routed.geometry;
              distanceKm = routed.distanceKm;
              durationSec = routed.durationSec;
              routeLegs = routed.legs || [];
              engine = "osrm";
              if (!geometry.length) {
                warning = "OSRM returned an empty geometry; check extract coverage for these points";
              }
            } catch (routeErr) {
              // Table worked — keep road distances/times from matrix; geometry is straight segments only.
              geometry = straightGeometry(ordered);
              const opt = preserveOrder
                ? { distance: pathDistanceHaversine(points) }
                : optimizeOpenTour(points, matrixKm);
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
              routeLegs = haversineRoute(ordered).legs;
              engine = "osrm";
              warning = `OSRM table OK but route geometry failed (${routeErr instanceof Error ? routeErr.message : String(routeErr)}); showing straight segments`;
            }
          }
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

      // Leg distances for Excel (haversine labels)
      const legs = [];
      for (let i = 0; i < orderedStops.length - 1; i++) {
        const a = orderedStops[i];
        const b = orderedStops[i + 1];
        const routed = routeLegs[i];
        legs.push({
          from: a.label || `Point ${i}`,
          to: b.label || `Point ${i + 1}`,
          distanceKm:
            routed?.distanceKm != null
              ? routed.distanceKm
              : Math.round(haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000) / 1000,
          durationSec: routed?.durationSec ?? null,
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
        routeLegs,
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
