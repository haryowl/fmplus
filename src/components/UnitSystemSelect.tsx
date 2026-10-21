import { UNIT_SYSTEM_OPTIONS } from "../lib/units";
import { useUnitSystem } from "../lib/unitSystem";

type Props = {
  id?: string;
  className?: string;
  compact?: boolean;
};

export function UnitSystemSelect({ id = "unit-system", className, compact }: Props) {
  const { system, setSystem } = useUnitSystem();
  const select = (
    <select
      id={id}
      value={system}
      onChange={(e) => setSystem(e.target.value === "nautical" ? "nautical" : "metric")}
    >
      {UNIT_SYSTEM_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
  if (compact) {
    return (
      <label className={className || "fleet-cc-field"}>
        <span>Units</span>
        {select}
      </label>
    );
  }
  return (
    <div className={className || "field"}>
      <label htmlFor={id}>Units</label>
      {select}
    </div>
  );
}
