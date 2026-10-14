import { useEffect } from "react";
import { BrandMark } from "../components/BrandMark";
import { DispatchCustomersPanel } from "../components/DispatchCustomersPanel";
import { ViewNav } from "../components/ViewNav";
import { jobsHref, navigateView } from "../lib/routing";

/** Desk Customers master list (pick into Jobs order form stays on Jobs). */
export default function DispatchCustomersPage() {
  useEffect(() => {
    document.title = "Customers · ARMADA M.1";
  }, []);

  const search = typeof window !== "undefined" ? window.location.search : "";

  return (
    <div className="app dispatch-page dispatch-customers-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Customers</h1>
            <p>Master list for orders · pin · zone</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchCustomers" />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigateView(jobsHref(search))}
          >
            Back to Jobs
          </button>
        </div>
      </header>
      <main className="shell dispatch-shell">
        <DispatchCustomersPanel />
      </main>
    </div>
  );
}
