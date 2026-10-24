import { IcoDash, IcoOdo, IcoUtil } from "./fleetLiveIcons";

export type DashSubnavId = "dashboard" | "full" | "fleet";

export type DashSubnavItem = {
  id: DashSubnavId;
  label: string;
};

const ICONS: Record<DashSubnavId, typeof IcoDash> = {
  dashboard: IcoDash,
  full: IcoOdo,
  fleet: IcoUtil,
};

type Props = {
  current: DashSubnavId;
  items: DashSubnavItem[];
  onChange: (id: DashSubnavId) => void;
};

export function FleetLiveDashSubnav({ current, items, onChange }: Props) {
  if (items.length < 2) return null;
  return (
    <nav className="fleet-cc-subnav" aria-label="Dashboard views">
      {items.map((item) => {
        const Icon = ICONS[item.id];
        return (
          <button
            key={item.id}
            type="button"
            className={current === item.id ? "is-active" : ""}
            onClick={() => onChange(item.id)}
            aria-current={current === item.id ? "page" : undefined}
          >
            <Icon />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
