import type { DispatchBalanceGoal } from "../lib/dispatch";
import { PLAN_BALANCE_GOAL_OPTIONS } from "../lib/dispatchPlanBalance";

type Props = {
  value: DispatchBalanceGoal[];
  onChange: (next: DispatchBalanceGoal[]) => void;
};

/** Auto-plan day multi-select load balance goals. */
export function DispatchPlanBalanceGoals({ value, onChange }: Props) {
  return (
    <div className="field dispatch-plan-balance-goals">
      <span className="dispatch-plan-balance-label">Balance across vehicles</span>
      {PLAN_BALANCE_GOAL_OPTIONS.map((opt) => (
        <label key={opt.id} className="dispatch-plan-check">
          <input
            type="checkbox"
            checked={value.includes(opt.id)}
            onChange={() => {
              onChange(
                value.includes(opt.id) ? value.filter((g) => g !== opt.id) : [...value, opt.id],
              );
            }}
          />
          {opt.label}
        </label>
      ))}
      <p className="dispatch-search-hint">
        Capacity limits always apply. Checked items even out work across vehicles after packing.
      </p>
    </div>
  );
}
