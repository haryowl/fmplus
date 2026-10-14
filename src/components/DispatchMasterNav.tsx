import { customersHref, goodsHref, jobsHref, navigateView, type AppView } from "../lib/routing";

const TABS: { view: AppView; label: string; href: (search: string) => string }[] = [
  { view: "dispatchDesk", label: "Dispatch", href: jobsHref },
  { view: "dispatchGoods", label: "Goods", href: goodsHref },
  { view: "dispatchCustomers", label: "Customers", href: customersHref },
];

type Props = {
  current: "dispatchDesk" | "dispatchGoods" | "dispatchCustomers";
  counts?: Partial<Record<"dispatchGoods" | "dispatchCustomers", number>>;
};

/** Compact Jobs / Goods / Customers strip for master-data pages (Modern-Redesign). */
export function DispatchMasterNav({ current, counts }: Props) {
  const search = typeof window !== "undefined" ? window.location.search : "";

  return (
    <nav className="dispatch-master-nav" aria-label="Dispatch master data">
      {TABS.map((tab) => {
        const active = tab.view === current;
        const count =
          tab.view === "dispatchGoods" || tab.view === "dispatchCustomers"
            ? counts?.[tab.view]
            : undefined;
        return active ? (
          <span key={tab.view} className="dispatch-master-nav-tab is-on">
            {tab.label}
            {typeof count === "number" ? <em>{count}</em> : null}
          </span>
        ) : (
          <a
            key={tab.view}
            className="dispatch-master-nav-tab"
            href={tab.href(search)}
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              event.preventDefault();
              navigateView(tab.href(search));
            }}
          >
            {tab.label}
            {typeof count === "number" ? <em>{count}</em> : null}
          </a>
        );
      })}
    </nav>
  );
}
