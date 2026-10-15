import { useEffect } from "react";
import { BrandMark } from "../components/BrandMark";
import { DispatchCustomersPanel } from "../components/DispatchCustomersPanel";
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
        <DispatchCustomersPanel />
      </main>
    </div>
  );
}
