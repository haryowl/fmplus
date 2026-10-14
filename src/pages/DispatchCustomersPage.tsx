import { useEffect } from "react";
import { BrandMark } from "../components/BrandMark";
import { DispatchCustomersPanel } from "../components/DispatchCustomersPanel";
import { DispatchMasterNav } from "../components/DispatchMasterNav";
import { ViewNav } from "../components/ViewNav";

/** Desk Customers master list (pick into Jobs order form stays on Jobs). */
export default function DispatchCustomersPage() {
  useEffect(() => {
    document.title = "Customers · ARMADA M.1";
  }, []);

  return (
    <div className="app dispatch-page dispatch-customers-page dispatch-master-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Customers</h1>
            <p>Delivery points, zones, routing</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchCustomers" />
        </div>
      </header>
      <main className="shell dispatch-shell dispatch-master-shell">
        <div className="dispatch-master-page-head">
          <div>
            <h2 className="dispatch-master-title">
              Customers
              <span className="dispatch-master-sub">— Delivery points, zones, routing</span>
            </h2>
          </div>
          <span className="dispatch-master-live" aria-label="Live">
            <i aria-hidden /> Live
          </span>
        </div>
        <DispatchMasterNav current="dispatchCustomers" />
        <DispatchCustomersPanel />
      </main>
    </div>
  );
}
