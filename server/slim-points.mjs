/**
 * Keep only the GPS/CAN fields the dashboard reads.
 * Armada's per-point variables blob is the bulk of each vehicle-day payload.
 */

const KEEP_VARS = new Set([
  "speed",
  "ignition",
  "odometerAcc",
  "caN300_EngineRPM",
  "caN300_FuelConsumed",
  "fuel level",
  "fuelLevel",
  "FuelLevel",
  "axisX",
  "AxisX",
  "axisY",
  "AxisY",
  "axisZ",
  "AxisZ",
  "harshBrakingDigital",
  "harshBrakingValue",
  "harshAccelerationDigital",
  "harshAccelerationValue",
  "harshCorneringDigital",
  "harshCorneringValue",
]);

function asUtc(raw) {
  const value = raw.utc ?? raw.uTC ?? raw.UTC ?? raw.serverUtc;
  return typeof value === "string" && value.trim() ? value : "";
}

function asVariables(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  if (Array.isArray(raw)) {
    const out = {};
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const name = typeof item.name === "string" ? item.name : "";
      if (name && KEEP_VARS.has(name) && item.value !== undefined) out[name] = item.value;
    }
    return Object.keys(out).length ? out : undefined;
  }
  const out = {};
  for (const key of KEEP_VARS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return Object.keys(out).length ? out : undefined;
}

function slimPoint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const utc = asUtc(raw);
  if (!utc) return null;
  const trackInfoId = Number(raw.trackInfoId ?? raw.trackinfoid ?? 0);
  const pos = raw.position && typeof raw.position === "object" && !Array.isArray(raw.position) ? raw.position : null;
  const row = {
    utc,
    position: pos
      ? {
          latitude: pos.latitude,
          longitude: pos.longitude,
          altitude: pos.altitude,
        }
      : undefined,
    variables: asVariables(raw.variables),
  };
  if (Number.isInteger(trackInfoId) && trackInfoId > 0) row.trackInfoId = trackInfoId;
  return row;
}

/** Parse Armada's day JSON and return a compact array string. */
export function slimPointsJson(body) {
  const text = String(body || "").trim();
  if (!text || text === "[]") return "[]";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "[]";
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
  const out = [];
  for (const item of list) {
    const row = slimPoint(item);
    if (row) out.push(row);
  }
  return JSON.stringify(out);
}
