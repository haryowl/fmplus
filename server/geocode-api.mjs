/**
 * Forward + reverse geocode for Dispatch (map-first order placement).
 * GET /api/geocode/search?q=
 * GET /api/geocode/reverse?lat=&lon=
 */
import { armadaFetch } from "./armada-fetch.mjs";
import { securityHeaders } from "./proxy-lt.mjs";
import { tenantFromRequest } from "./tenants.mjs";

const NOMINATIM_UA = "FM-Plus-Dispatch/1.0 (https://github.com/haryowl/fmplus)";

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

      let label = "";
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
            if (label) source = "armada";
          }
        } catch {
          /* fall through */
        }
      }

      if (!label) {
        const params = new URLSearchParams({
          format: "json",
          lat: String(lat),
          lon: String(lon),
          zoom: "18",
          addressdetails: "0",
        });
        const raw = await nominatimFetch(
          `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
        );
        label =
          raw && typeof raw === "object" && typeof raw.display_name === "string"
            ? raw.display_name.trim()
            : "";
        source = "nominatim";
      }

      json(res, 200, {
        label: label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        lat,
        lon,
        source,
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
