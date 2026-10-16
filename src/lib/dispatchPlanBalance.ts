import type { DispatchBalanceGoal } from "./dispatch";

export const PLAN_BALANCE_GOALS_KEY = "dispatchPlanBalanceGoals";

export const PLAN_BALANCE_GOAL_OPTIONS: { id: DispatchBalanceGoal; label: string }[] = [
  { id: "fill", label: "Capacity fill %" },
  { id: "stops", label: "Stop count" },
  { id: "distance", label: "Distance (km)" },
  { id: "duration", label: "Time (drive + service)" },
];

export function loadPlanBalanceGoals(): DispatchBalanceGoal[] {
  try {
    const raw = localStorage.getItem(PLAN_BALANCE_GOALS_KEY);
    if (raw == null) return ["fill"];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ["fill"];
    const allowed = new Set(PLAN_BALANCE_GOAL_OPTIONS.map((o) => o.id));
    const out: DispatchBalanceGoal[] = [];
    for (const g of parsed) {
      const id = String(g || "") as DispatchBalanceGoal;
      if (allowed.has(id) && !out.includes(id)) out.push(id);
    }
    return out;
  } catch {
    return ["fill"];
  }
}

/** Human label for Auto-plan day unassigned[].reason codes. */
export function planUnassignedReasonLabel(reason: string): string {
  switch (String(reason || "").toLowerCase()) {
    case "no_coords":
      return "No coordinates";
    case "no_vehicle_at_depot":
      return "No vehicle at depot";
    case "exceeds_all_vehicle_capacity":
      return "Exceeds all vehicle capacity";
    case "no_feasible_insertion":
      return "No feasible insertion";
    case "time_window_or_capacity":
      return "Time window or capacity";
    case "no_shift_time_for_next_trip":
      return "No shift time for next trip";
    case "pair_requires_depot":
      return "Pickup/drop needs depot or multi-depot";
    case "cross_depot_pair":
      return "Pickup and drop in different depot areas";
    default:
      return reason ? reason.replace(/_/g, " ") : "Unassigned";
  }
}
