import { FLEET_VEHICLE_CAP } from "../lib/config";
import { userOptionLabel } from "../lib/api";
import type { User } from "../lib/types";

type Props = {
  users: User[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  dense?: boolean;
};

export function VehiclePicker({ users, selectedIds, onChange, disabled, dense }: Props) {
  const selected = new Set(selectedIds);
  const atCap = selected.size >= FLEET_VEHICLE_CAP;

  function toggle(id: string) {
    if (selected.has(id)) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    if (atCap) return;
    onChange([...selectedIds, id]);
  }

  function selectAll() {
    onChange(users.map((u) => String(u.id)).slice(0, FLEET_VEHICLE_CAP));
  }

  return (
    <div className={dense ? "vehicle-picker dense" : "vehicle-picker"}>
      <div className="vehicle-picker-bar">
        <span>
          {selectedIds.length} of {Math.min(users.length, FLEET_VEHICLE_CAP)}
          {users.length > FLEET_VEHICLE_CAP ? ` · cap ${FLEET_VEHICLE_CAP}` : ""}
        </span>
        <button type="button" className="linkish" disabled={disabled || users.length === 0} onClick={selectAll}>
          {users.length > FLEET_VEHICLE_CAP ? `Select ${FLEET_VEHICLE_CAP}` : "Select all"}
        </button>
      </div>
      <div className="vehicle-picker-list" role="group" aria-label="Vehicles in group">
        {users.length === 0 ? (
          <p className="vehicle-picker-empty">Choose a group first</p>
        ) : (
          users.map((user) => {
            const id = String(user.id);
            const checked = selected.has(id);
            const name = userOptionLabel(user);
            return (
              <label key={id} className={checked ? "on" : ""} title={name}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (!checked && atCap)}
                  onChange={() => toggle(id)}
                />
                <span>{name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}
