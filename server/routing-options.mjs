/**
 * OSRM car-profile exclude flags (stock car.lua: toll, motorway, ferry).
 * Soft "prefer" needs a custom lua + re-extract — not supported here.
 */

export const OSRM_EXCLUDE_CLASSES = ["toll", "motorway", "ferry"];

/**
 * @typedef {{
 *   avoidTolls: boolean,
 *   avoidMotorways: boolean,
 *   avoidFerries: boolean,
 *   exclude: string[],
 * }} RoutingOptions
 */

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
    if (OSRM_EXCLUDE_CLASSES.includes(s)) exclude.add(s);
  }
  return {
    avoidTolls: exclude.has("toll"),
    avoidMotorways: exclude.has("motorway"),
    avoidFerries: exclude.has("ferry"),
    exclude: [...exclude],
  };
}

/** Append `&exclude=toll,motorway` when any classes set. */
export function osrmExcludeQuery(opts) {
  const list = opts?.exclude;
  if (!Array.isArray(list) || !list.length) return "";
  const clean = list
    .map((x) => String(x).toLowerCase().trim())
    .filter((x) => OSRM_EXCLUDE_CLASSES.includes(x));
  if (!clean.length) return "";
  return `&exclude=${clean.join(",")}`;
}

export function routingOptionsSummary(opts) {
  if (!opts?.exclude?.length) return "";
  const labels = [];
  if (opts.avoidTolls) labels.push("no tolls");
  if (opts.avoidMotorways) labels.push("no motorways");
  if (opts.avoidFerries) labels.push("no ferries");
  return labels.join(" · ");
}
