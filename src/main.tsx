import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./components/registerCharts";
import App from "./App";
import CompactDashboard from "./pages/CompactDashboard";
import FleetCompact from "./pages/FleetCompact";
import FleetDashboard from "./pages/FleetDashboard";
import { viewFromPath } from "./lib/routing";
import { bootTenantFromSearch } from "./lib/tenant";
import "./styles.css";

bootTenantFromSearch(window.location.search);

const view = viewFromPath(window.location.pathname);
const Page =
  view === "fleetCompact"
    ? FleetCompact
    : view === "fleet"
      ? FleetDashboard
      : view === "compact"
        ? CompactDashboard
        : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
