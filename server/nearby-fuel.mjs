/**
 * Nearest OpenStreetMap fuel amenity (no Google Places).
 * GET /api/nearby-fuel?lat=&lon=
 */
const SEARCH_M = 300;
const TIMEOUT_MS = 12_000;
const cache = new Map();
const CACHE_MAX = 200;

function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cacheKey(lat, lon) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function fuelName(tags) {
  if (!tags || typeof tags !== "object") return "";
  return String(tags.name || tags.brand || tags.operator || "").trim();
}

function coordsOf(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lon: el.lon };
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

async function nearestFuel(lat, lon) {
  const query = `[out:json][timeout:10];(node["amenity"="fuel"](around:${SEARCH_M},${lat},${lon});way["amenity"="fuel"](around:${SEARCH_M},${lat},${lon}););out center tags 16;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "application/json",
      "user-agent": "fmplus/1.0 (vehicle metrics refill map)",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const raw = await res.json();
  const elements = Array.isArray(raw?.elements) ? raw.elements : [];
  let best = null;
  for (const el of elements) {
    const at = coordsOf(el);
    if (!at) continue;
    const distanceM = haversineM(lat, lon, at.lat, at.lon);
    if (distanceM > SEARCH_M) continue;
    if (!best || distanceM < best.distanceM) {
      best = {
        name: fuelName(el.tags) || "Unnamed fuel station",
        distanceM: Math.round(distanceM),
        lat: at.lat,
        lon: at.lon,
      };
    }
  }
  return best;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<boolean>}
 */
export async function handleNearbyFuelRequest(req, res) {
  const rawUrl = req.url || "/";
  const pathOnly = rawUrl.split("?")[0];
  if (pathOnly !== "/api/nearby-fuel") return false;

  const json = (status, obj) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(obj));
  };

  if (req.method !== "GET") {
    json(405, { error: "Method not allowed" });
    return true;
  }

  const params = new URL(rawUrl, "http://localhost").searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    json(400, { error: "lat and lon required" });
    return true;
  }

  const key = cacheKey(lat, lon);
  if (cache.has(key)) {
    json(200, cache.get(key));
    return true;
  }

  try {
    const nearest = await nearestFuel(lat, lon);
    const payload = nearest
      ? { found: true, ...nearest, source: "OpenStreetMap" }
      : { found: false, source: "OpenStreetMap" };
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, payload);
    json(200, payload);
  } catch {
    json(200, { found: false, source: "OpenStreetMap", error: "lookup failed" });
  }
  return true;
}
