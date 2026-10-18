import {
  compactHref,
  customersHref,
  dispatchLiveHref,
  exceptionsHref,
  fleetCompactHref,
  fleetHref,
  fleetLiveHref,
  fullHref,
  goodsHref,
  liveHref,
  maintenanceHref,
  navigateView,
  placesHref,
  routePlanHref,
  jobsHref,
  statusHref,
  tripsHref,
  type AppView,
} from "../lib/routing";
import { dispatchProfiles, moduleKeyForView } from "../lib/entitlements";
import { isNativeDispatchApp } from "../lib/nativeField";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import { DeskAuthChip } from "./DeskAuthChip";
import { ThemePicker } from "./ThemePicker";

const LINKS: { view: AppView; label: string; href: (search: string) => string }[] = [
  { view: "full", label: "Full", href: fullHref },
  { view: "compact", label: "Compact", href: compactHref },
  { view: "fleet", label: "Fleet", href: fleetHref },
  { view: "fleetCompact", label: "Ranking", href: fleetCompactHref },
  { view: "trips", label: "Trips", href: tripsHref },
  { view: "status", label: "Status", href: statusHref },
  { view: "live", label: "Live", href: liveHref },
  { view: "fleetLive", label: "Fleet Live", href: fleetLiveHref },
  { view: "exceptions", label: "Exceptions", href: exceptionsHref },
  { view: "places", label: "Places", href: placesHref },
  { view: "routePlan", label: "Route", href: routePlanHref },
  { view: "dispatchDesk", label: "Jobs", href: jobsHref },
  { view: "dispatchGoods", label: "Goods & Stock", href: goodsHref },
  { view: "dispatchCustomers", label: "Customers", href: customersHref },
  { view: "dispatchLive", label: "Dispatch Live", href: dispatchLiveHref },
  { view: "maintenance", label: "Maintenance", href: maintenanceHref },
];

/** Dispatch APK: execution only — catalog/customers admin stays on desk browser. */
const DISPATCH_APP_LINKS = LINKS.filter(
  (link) => link.view === "dispatchDesk" || link.view === "dispatchLive",
);

type Props = {
  current: AppView;
};

export function ViewNav({ current }: Props) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const { ready, moduleAllowed, entitlements } = useEmbedTenant();
  const profiles = dispatchProfiles(entitlements);
  const base = isNativeDispatchApp() ? DISPATCH_APP_LINKS : LINKS;

  if (!ready) {
    return (
      <>
        <nav className="view-nav" aria-label="Dashboard views" aria-busy="true" />
        <DeskAuthChip />
        <ThemePicker />
      </>
    );
  }

  const links = base.filter((link) => {
    if (!moduleAllowed(moduleKeyForView(link.view))) return false;
    // Goods & Stock is cargo-only admin
    if (link.view === "dispatchGoods" && !profiles.cargo) return false;
    return true;
  });

  return (
    <>
      <nav className="view-nav" aria-label="Dashboard views">
        {links.map((link) =>
          link.view === current ? (
            <span key={link.view} className="btn-ghost active">
              {link.label}
            </span>
          ) : (
            <a
              key={link.view}
              className="btn-ghost"
              href={link.href(search)}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                navigateView(link.href(search));
              }}
            >
              {link.label}
            </a>
          ),
        )}
      </nav>
      <DeskAuthChip />
      <ThemePicker />
    </>
  );
}
