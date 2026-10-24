import { UNIT_SYSTEM_OPTIONS } from "../lib/units";
import { useUnitSystem } from "../lib/unitSystem";
import { IcoUnits } from "./fleetLiveIcons";

type Props = {
  id?: string;
  className?: string;
  compact?: boolean;
  pill?: boolean;
};

export function UnitSystemSelect({ id = "unit-system", className, compact, pill }: Props) {
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
  if (pill) {
    return (
      <label className={className || "fleet-cc-pill"}>
        <IcoUnits />
        <span className="sr-only">Units</span>
        {select}
      </label>
    );
  }
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
