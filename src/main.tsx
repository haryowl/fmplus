import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./components/registerCharts";
import App from "./App";
import CompactDashboard from "./pages/CompactDashboard";
import FleetCompact from "./pages/FleetCompact";
import FleetDashboard from "./pages/FleetDashboard";
import LastStatus from "./pages/LastStatus";
import TripDetail from "./pages/TripDetail";
import { VIEW_CHANGE, viewFromPath, type AppView } from "./lib/routing";
import { bootTenantFromSearch } from "./lib/tenant";
import "./styles.css";

bootTenantFromSearch(window.location.search);

function pageFor(view: AppView) {
  if (view === "status") return LastStatus;
  if (view === "trips") return TripDetail;
  if (view === "fleetCompact") return FleetCompact;
  if (view === "fleet") return FleetDashboard;
  if (view === "compact") return CompactDashboard;
  return App;
}

function Root() {
  const [view, setView] = useState(() => viewFromPath(window.location.pathname));
  useEffect(() => {
    const sync = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", sync);
    window.addEventListener(VIEW_CHANGE, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(VIEW_CHANGE, sync);
    };
  }, []);
  const Page = pageFor(view);
  return <Page />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
