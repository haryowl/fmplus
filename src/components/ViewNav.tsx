import {
  compactHref,
  fleetCompactHref,
  fleetHref,
  fullHref,
  navigateView,
  statusHref,
  tripsHref,
  type AppView,
} from "../lib/routing";

const LINKS: { view: AppView; label: string; href: (search: string) => string }[] = [
  { view: "full", label: "Full", href: fullHref },
  { view: "compact", label: "Compact", href: compactHref },
  { view: "fleet", label: "Fleet", href: fleetHref },
  { view: "fleetCompact", label: "Ranking", href: fleetCompactHref },
  { view: "trips", label: "Trips", href: tripsHref },
  { view: "status", label: "Status", href: statusHref },
];

type Props = {
  current: AppView;
};

export function ViewNav({ current }: Props) {
  const search = typeof window !== "undefined" ? window.location.search : "";
  return (
    <nav className="view-nav" aria-label="Dashboard views">
      {LINKS.map((link) =>
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
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigateView(link.href(search));
            }}
          >
            {link.label}
          </a>
        ),
      )}
    </nav>
  );
}
