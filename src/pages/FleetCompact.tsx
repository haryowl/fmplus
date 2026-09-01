import { useEffect } from "react";
import {
  formatHours,
  formatIdr,
  formatInt,
  formatKm,
  formatKmPerL,
  formatLiters,
  formatPct,
} from "../lib/format";
import { movingSharePct } from "../lib/metrics";
import { useFleetDashboard } from "../lib/useFleetDashboard";
import type { Period } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { FleetBarChart } from "../components/FleetBarChart";
import { FleetRankTable } from "../components/FleetRankTable";
import { VehiclePicker } from "../components/VehiclePicker";
import { ViewNav } from "../components/ViewNav";

export default function FleetCompact() {
  const d = useFleetDashboard();
  const live = d.vehicles.filter((v) => v.hasData);
  const kmPerL = d.fleetFuel > 0 ? d.fleetGps / d.fleetFuel : 0;

  useEffect(() => {
    const root = document.documentElement;
    const previousTitle = document.title;
    root.classList.add("onesheet-root");
    document.title = "Fleet Metrics · Ranking";
    return () => {
      root.classList.remove("onesheet-root");
      document.title = previousTitle;
    };
  }, []);

  const banner = d.loading && d.progress
    ? {
        kind: "progress" as const,
        text:
          d.progress.phase === "trips"
            ? `Finding trips · ${d.progress.loaded}/${d.progress.total}`
            : `Tracks ${d.progress.loaded}/${d.progress.total}`,
      }
    : d.bootError
      ? { kind: "error" as const, text: d.bootError }
      : d.loadError
        ? { kind: "error" as const, text: d.loadError }
        : d.loadWarning
          ? { kind: "warn" as const, text: d.loadWarning }
          : null;

  return (
    <div className="app onesheet fleet-sheet">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={16} />
          <div>
            <h1>Fleet Metrics</h1>
            <p>Ranking · one page</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="fleetCompact" />
          <div className="vehicle-chip">
            {d.userIds.length ? `${d.userIds.length} selected` : "No vehicles"}
            {d.selectedGroup ? ` · ${d.selectedGroup.name}` : ""}
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="fc-group">Group</label>
            <select
              id="fc-group"
              value={d.groupId}
              disabled={d.hostLock.group}
              onChange={(e) => d.changeGroup(e.target.value)}
            >
              <option value="">
                {d.bootError ? "Groups unavailable" : d.groups.length ? "Select a group" : "Loading groups…"}
              </option>
              {d.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field fleet-picker-field">
            <label>Vehicles</label>
            <VehiclePicker
              dense
              users={d.users}
              selectedIds={d.userIds}
              onChange={d.changeUserIds}
            />
          </div>
          <div className="field">
            <label htmlFor="fc-from">From</label>
            <input
              id="fc-from"
              type="date"
              value={d.dateFrom}
              disabled={d.hostLock.from}
              onChange={(e) => d.setDateFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="fc-to">To</label>
            <input
              id="fc-to"
              type="date"
              value={d.dateTo}
              disabled={d.hostLock.to}
              onChange={(e) => d.setDateTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Period</label>
            <div className="period-switch" role="tablist" aria-label="Period">
              {(["daily", "weekly", "monthly"] as Period[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={d.period === item ? "active" : ""}
                  onClick={() => d.setPeriod(item)}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void d.handleLoad()}
            disabled={d.userIds.length === 0 || d.loading}
          >
            {d.loading ? "Loading…" : "Load"}
          </button>
        </section>

        {banner && (
          <div className={`banner ${banner.kind === "progress" ? "progress" : banner.kind}`}>
            <span>{banner.text}</span>
            {banner.kind === "progress" && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${d.progressPct}%` }} />
              </div>
            )}
          </div>
        )}

        <section className="kpis">
          <article className="kpi" style={{ ["--tick" as string]: "var(--gps)" }}>
            <div className="label">Vehicles</div>
            <div className="value">{d.byUserId ? formatInt(d.loadedCount) : "—"}</div>
            <div className="unit">loaded</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--ign)" }}>
            <div className="label">GPS</div>
            <div className="value">{d.byUserId ? formatKm(d.fleetGps) : "—"}</div>
            <div className="unit">km</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--hrs)" }}>
            <div className="label">Active</div>
            <div className="value">{d.byUserId ? formatHours(d.fleetHours) : "—"}</div>
            <div className="unit">
              {d.byUserId ? `${formatPct(movingSharePct(d.fleetHours, d.fleetIdle))} moving` : "h"}
            </div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--odo)" }}>
            <div className="label">Fuel</div>
            <div className="value">{d.byUserId ? formatLiters(d.fleetFuel) : "—"}</div>
            <div className="unit">{kmPerL > 0 ? `${formatKmPerL(kmPerL)} km/l` : "L"}</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--accent)" }}>
            <div className="label">Cost</div>
            <div className="value">{d.byUserId ? formatIdr(d.fleetCost) : "—"}</div>
            <div className="unit">IDR</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--danger)" }}>
            <div className="label">Worst safety</div>
            <div className="value">
              {live.length
                ? Math.min(...live.map((v) => v.behavior?.safetyScore ?? 100)).toFixed(0)
                : "—"}
            </div>
            <div className="unit">score</div>
          </article>
        </section>

        {live.length === 0 ? (
          <div className="empty onesheet-empty">
            <div>
              <h3>{d.byUserId ? "No points in this range" : "Select vehicles to rank"}</h3>
              <p>
                Last used vehicle is pre-selected. Add others from the group, then load. Switch to Fleet
                for the full comparison charts.
              </p>
            </div>
          </div>
        ) : (
          <div className="onesheet-grid fleet-rank-grid">
            <section className="panel onesheet-cell fleet-rank-main">
              <div className="panel-head">
                <h2>Ranking</h2>
              </div>
              <FleetRankTable vehicles={d.vehicles} dense />
            </section>
            <section className="panel onesheet-cell">
              <div className="panel-head">
                <h2>km/l</h2>
              </div>
              <FleetBarChart
                labels={live.map((v) => v.label)}
                series={[
                  {
                    label: "km/l",
                    data: live.map((v) => (v.totals.fuel > 0 ? v.totals.gps / v.totals.fuel : 0)),
                    color: "#0b6b62",
                  },
                ]}
                unit="km/l"
              />
            </section>
            <section className="panel onesheet-cell onesheet-analysis">
              <div className="panel-head">
                <h2>Analysis</h2>
              </div>
              <div className="insight-stack">
                {d.insights.map((block) => (
                  <article key={block.id} className="insight-item">
                    <h3>{block.title}</h3>
                    <p>{block.body}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
