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

/** Active desk mode when tenant has both cargo and passenger. */
export function resolveDispatchDeskMode(profiles, requested) {
  const req = String(requested || "").toLowerCase();
  if (req === "passenger" && profiles.passenger) return "passenger";
  if (req === "cargo" && profiles.cargo) return "cargo";
  if (profiles.passenger && !profiles.cargo) return "passenger";
  return "cargo";
}
