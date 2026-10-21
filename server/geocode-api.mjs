/**
 * Forward + reverse geocode for Dispatch (map-first order placement).
 * GET /api/geocode/search?q=
 * GET /api/geocode/reverse?lat=&lon=
 */
import { armadaFetch } from "./armada-fetch.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { tenantFromRequest } from "./tenants.mjs";

const NOMINATIM_UA = "ARMADA-M1/1.0 (https://github.com/haryowl/fmplus)";
const REVERSE_CACHE_TTL_MS = 30 * 60 * 1000;
const REVERSE_CACHE_MAX = 4000;
const NOMINATIM_GAP_MS = 1100;

/** @type {Map<string, { label: string, short: string, at: number }>} */
const reverseCache = new Map();
let reverseTail = Promise.resolve();
let lastNominatimAt = 0;

function reverseCacheKey(lat, lon) {
  return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
}

function readReverseCache(lat, lon) {
  const hit = reverseCache.get(reverseCacheKey(lat, lon));
  if (!hit) return null;
  if (Date.now() - hit.at > REVERSE_CACHE_TTL_MS) {
    reverseCache.delete(reverseCacheKey(lat, lon));
    return null;
  }
  return hit;
}

function writeReverseCache(lat, lon, label, short) {
  reverseCache.set(reverseCacheKey(lat, lon), { label, short, at: Date.now() });
  if (reverseCache.size <= REVERSE_CACHE_MAX) return;
  const first = reverseCache.keys().next().value;
  if (first) reverseCache.delete(first);
}

function formatNominatim(raw) {
  const display = raw && typeof raw.display_name === "string" ? raw.display_name.trim() : "";
  const a = raw?.address && typeof raw.address === "object" ? raw.address : {};
  const str = (key) => (typeof a[key] === "string" ? a[key].trim() : "");
  const road = str("road") || str("pedestrian") || str("residential") || str("footway") || str("highway");
  const house = str("house_number");
  const street = [house, road].filter(Boolean).join(" ").trim();
  const locality = str("suburb") || str("neighbourhood") || str("village") || str("hamlet") || str("quarter");
  const city = str("city") || str("town") || str("municipality") || str("county");
  const state = str("state");
  const short = [...new Set([street, locality, city, state].filter(Boolean))].join(", ");
  return { label: display || short, short: short || display };
}

function enqueueReverse(fn) {
  const run = reverseTail.then(fn, fn);
  reverseTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function nominatimReverse(lat, lon) {
  const wait = NOMINATIM_GAP_MS - (Date.now() - lastNominatimAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimAt = Date.now();
  const params = new URLSearchParams({
    format: "json",
    lat: String(lat),
    lon: String(lon),
    zoom: "18",
    addressdetails: "1",
  });
  const raw = await nominatimFetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);
  return formatNominatim(raw);
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

async function nominatimFetch(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": NOMINATIM_UA,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const err = new Error(`Nominatim ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function parseArmadaAddress(raw) {
  if (typeof raw === "string") return raw.trim();
  if (!raw || typeof raw !== "object") return "";
  const row = /** @type {Record<string, unknown>} */ (raw);
  for (const key of ["formattedResult", "address", "Address", "formattedAddress", "label", "name"]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (row.location && typeof row.location === "object") return parseArmadaAddress(row.location);
  if (row.result !== undefined) return parseArmadaAddress(row.result);
  return "";
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export async function handleGeocodeRequest(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/geocode")) return false;

  try {
    if (url.pathname === "/api/geocode/search" && req.method === "GET") {
      const q = String(url.searchParams.get("q") || "").trim();
      if (q.length < 2) {
        json(res, 200, { results: [] });
        return true;
      }
      const params = new URLSearchParams({
        format: "json",
        q,
        countrycodes: "id",
        limit: "8",
        addressdetails: "0",
      });
      const raw = await nominatimFetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      );
      const list = Array.isArray(raw) ? raw : [];
      const results = list
        .map((row) => {
          const lat = Number(row.lat);
          const lon = Number(row.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          return {
            label: String(row.display_name || "").trim() || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
            lat,
            lon,
          };
        })
        .filter(Boolean);
      json(res, 200, { results });
      return true;
    }

    if (url.pathname === "/api/geocode/reverse" && req.method === "GET") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        json(res, 400, { error: "lat and lon required" });
        return true;
      }

      const cached = readReverseCache(lat, lon);
      if (cached) {
        json(res, 200, {
          label: cached.label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
          short: cached.short || cached.label,
          lat,
          lon,
          source: "cache",
        });
        return true;
      }

      const resolved = await enqueueReverse(async () => {
        const again = readReverseCache(lat, lon);
        if (again) return { ...again, source: "cache" };

        let label = "";
        let short = "";
        let source = "nominatim";

        const tenant = tenantFromRequest(req);
        if (tenant?.token && tenant.appId) {
          try {
            const armadaUrl = `https://armada.id/lt/api/v.1/applications/${tenant.appId}/reversegeocode?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`;
            const armadaRes = await armadaFetch(armadaUrl, {
              method: "GET",
              headers: {
                authorization: tenant.token,
                accept: "application/json",
              },
              timeoutMs: 8_000,
            });
            if (armadaRes.ok) {
              const text = armadaRes.buffer
                ? armadaRes.buffer.toString("utf8")
                : await armadaRes.text();
              let parsed;
              try {
                parsed = JSON.parse(text);
              } catch {
                parsed = text;
              }
              label = parseArmadaAddress(parsed);
              if (label) {
                short = label;
                source = "armada";
              }
            }
          } catch {
            /* fall through to Nominatim */
          }
        }

        if (!label) {
          const osm = await nominatimReverse(lat, lon);
          label = osm.label;
          short = osm.short;
          source = "nominatim";
        }

        const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        const out = {
          label: label || fallback,
          short: short || label || fallback,
          source,
        };
        writeReverseCache(lat, lon, out.label, out.short);
        return out;
      });

      json(res, 200, {
        label: resolved.label,
        short: resolved.short,
        lat,
        lon,
        source: resolved.source,
      });
      return true;
    }

    json(res, 404, { error: "Not found" });
    return true;
  } catch (err) {
    const status = err?.status || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[geocode]", message);
    json(res, status >= 400 && status < 600 ? status : 500, { error: message });
    return true;
  }
}
