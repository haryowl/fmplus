/**
 * Dispatch operation profiles (cargo / passenger / sales).
 * Feature flags under entitlements.features — not separate modules.
 */
import { mergeEntitlements } from "./entitlements.mjs";

/**
 * @returns {{ cargo: boolean, passenger: boolean, sales: boolean }}
 */
export function parseDispatchProfiles(entitlements) {
  const e = mergeEntitlements(entitlements);
  return {
    // Default on for back-compat when unset
    cargo: e.features.dispatchCargo !== false,
    passenger: e.features.dispatchPassenger === true,
    sales: e.features.dispatchSales === true,
  };
}

/**
 * Active desk mode among enabled profiles.
 * @returns {"cargo"|"passenger"|"sales"}
 */
export function resolveDispatchDeskMode(profiles, requested) {
  const req = String(requested || "").toLowerCase();
  if (req === "sales" && profiles.sales) return "sales";
  if (req === "passenger" && profiles.passenger) return "passenger";
  if (req === "cargo" && profiles.cargo) return "cargo";
  if (profiles.sales && !profiles.cargo && !profiles.passenger) return "sales";
  if (profiles.passenger && !profiles.cargo) return "passenger";
  if (profiles.cargo) return "cargo";
  if (profiles.passenger) return "passenger";
  if (profiles.sales) return "sales";
  return "cargo";
}

export function enabledDeskModes(profiles) {
  const modes = [];
  if (profiles.cargo) modes.push("cargo");
  if (profiles.passenger) modes.push("passenger");
  if (profiles.sales) modes.push("sales");
  return modes;
}
