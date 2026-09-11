/**
 * OSRM car-profile exclude flags + Jakarta ganjil–genap resolution.
 * Stock: toll, motorway, ferry. Custom: ganjil_genap (car-fmplus.lua rebuild).
 */
import { ganjilGenapDecision, jakartaDateTimeFromYmdAndHm, normalizePlateParity } from "./ganjil-genap.mjs";

export const OSRM_EXCLUDE_CLASSES = ["toll", "motorway", "ferry", "ganjil_genap"];

/**
 * @typedef {{
 *   avoidTolls: boolean,
 *   avoidMotorways: boolean,
 *   avoidFerries: boolean,
 *   respectGanjilGenap: boolean,
 *   plateParity: "odd"|"even"|"unknown"|"exempt",
 *   at: string | null,
 *   serviceDate: string | null,
 *   dayStart: string | null,
 *   exclude: string[],
 *   ganjilGenap: object | null,
 *   osrmBaseOverride: string | null,
 * }} RoutingOptions
 */

function allowedExcludeClass(s) {
  const name = String(process.env.OSRM_GANJIL_GENAP_CLASS || "ganjil_genap")
    .toLowerCase()
    .trim();
  if (OSRM_EXCLUDE_CLASSES.includes(s)) return true;
  if (name && s === name) return true;
  return false;
}

/**
 * Parse routing options from API body (`routing` object or flat flags).
 * @param {unknown} raw
 * @returns {RoutingOptions}
 */
export function parseRoutingOptions(raw) {
  const src =
    raw && typeof raw === "object" && raw.routing && typeof raw.routing === "object"
      ? raw.routing
      : raw && typeof raw === "object"
        ? raw
        : {};
  /** @type {Set<string>} */
  const exclude = new Set();
  if (src.avoidTolls === true || src.avoid_tolls === true) exclude.add("toll");
  if (src.avoidMotorways === true || src.avoid_motorways === true) exclude.add("motorway");
  if (src.avoidFerries === true || src.avoid_ferries === true) exclude.add("ferry");
  const list = Array.isArray(src.exclude) ? src.exclude : [];
  for (const x of list) {
    const s = String(x || "")
      .toLowerCase()
      .trim();
    if (allowedExcludeClass(s)) exclude.add(s);
  }

  const plateParity = normalizePlateParity(src.plateParity ?? src.plate_parity);
  const respectGanjilGenap =
    src.respectGanjilGenap === true ||
    src.respect_ganjil_genap === true ||
    src.avoidGanjilGenap === true ||
    src.ganjilGenap === true;
  const serviceDate =
    src.serviceDate != null
      ? String(src.serviceDate).slice(0, 10)
      : src.service_date != null
        ? String(src.service_date).slice(0, 10)
        : null;
  const dayStart =
    src.dayStart != null
      ? String(src.dayStart).trim()
      : src.day_start != null
        ? String(src.day_start).trim()
        : null;
  let at = src.at != null ? src.at : null;
  if (!at && serviceDate) {
    at = jakartaDateTimeFromYmdAndHm(serviceDate, dayStart || "08:00").toISOString();
  }

  /** @type {RoutingOptions} */
  const opts = {
    avoidTolls: exclude.has("toll"),
    avoidMotorways: exclude.has("motorway"),
    avoidFerries: exclude.has("ferry"),
    respectGanjilGenap,
    plateParity,
    at: at != null ? String(at) : null,
    serviceDate,
    dayStart,
    exclude: [...exclude],
    ganjilGenap: null,
    osrmBaseOverride: null,
  };
  return applyGanjilGenapToRouting(opts);
}

/**
 * Resolve plate/time → maybe add ganjil_genap exclude or restricted OSRM base.
 * @param {RoutingOptions} opts
 */
export function applyGanjilGenapToRouting(opts) {
  if (!opts.respectGanjilGenap) {
    opts.ganjilGenap = ganjilGenapDecision({
      plateParity: opts.plateParity,
      at: opts.at,
      respect: false,
    });
    return opts;
  }
  const decision = ganjilGenapDecision({
    plateParity: opts.plateParity,
    at: opts.at,
    respect: true,
  });
  opts.ganjilGenap = decision;
  if (decision.avoidCorridors) {
    if (decision.useRestrictedBase && decision.restrictedBaseUrl) {
      opts.osrmBaseOverride = decision.restrictedBaseUrl;
    } else if (decision.excludeClass) {
      const set = new Set(opts.exclude);
      set.add(decision.excludeClass);
      opts.exclude = [...set];
    }
  }
  return opts;
}

/** Append `&exclude=toll,motorway` when any classes set. */
export function osrmExcludeQuery(opts) {
  const list = opts?.exclude;
  if (!Array.isArray(list) || !list.length) return "";
  const clean = [];
  for (const x of list) {
    const s = String(x).toLowerCase().trim();
    if (allowedExcludeClass(s) && !clean.includes(s)) clean.push(s);
  }
  if (!clean.length) return "";
  return `&exclude=${clean.join(",")}`;
}

export function routingOptionsSummary(opts) {
  const labels = [];
  if (opts?.avoidTolls) labels.push("no tolls");
  if (opts?.avoidMotorways) labels.push("no motorways");
  if (opts?.avoidFerries) labels.push("no ferries");
  if (opts?.ganjilGenap?.avoidCorridors) labels.push("ganjil–genap corridors");
  else if (opts?.respectGanjilGenap && opts?.ganjilGenap?.summary) {
    /* active but matching plate — no avoid label */
  }
  return labels.join(" · ");
}
