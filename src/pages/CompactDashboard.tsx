import { useEffect, useMemo } from "react";
import { groupOptionLabel, userLabel, userOptionLabel } from "../lib/api";
import {
  formatHours,
  formatIdr,
  formatKm,
  formatKmPerL,
  formatLiters,
  formatMeters,
  formatPct,
  formatRpm,
  formatSpeed,
} from "../lib/format";
import { buildInsights } from "../lib/insight";
import { movingSharePct } from "../lib/metrics";
import { describeLoadProgress } from "../lib/dayTracks";
import { useVehicleDashboard } from "../lib/useVehicleDashboard";
import type { Period } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { DistanceChart } from "../components/DistanceChart";
import { FuelChart } from "../components/FuelChart";
import { SpeedRpmChart } from "../components/SpeedRpmChart";
import { UtilizationChart } from "../components/UtilizationChart";
import { ExportPdfButton } from "../components/ExportPdfButton";
import { ExportExcelButton } from "../components/ExportExcelButton";
import {
  compactSnapshotSheet,
  insightsSheet,
  periodDistanceSheet,
  periodFuelSheet,
  periodSpeedRpmSheet,
  periodUtilizationSheet,
  vehicleKpiSheet,
} from "../lib/panelExcel";
import { ViewNav } from "../components/ViewNav";

export default function CompactDashboard() {
  const {
    groups,
    users,
    groupId,
    setGroupId,
    userId,
    setUserId,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    timezone,
    period,
    setPeriod,
    setTrips,
    trips,
    loading,
    bootError,
    loadError,
    loadWarning,
    progress,
    progressPct,
    selectedGroup,
    selectedUser,
    rows,
    totals,
    behavior,
    insightInput,
    handleLoad,
  } = useVehicleDashboard();

  useEffect(() => {
    const root = document.documentElement;
    const previousTitle = document.title;
    root.classList.add("onesheet-root");
    document.title = "Vehicle Metrics · Compact";
    return () => {
      root.classList.remove("onesheet-root");
      document.title = previousTitle;
    };
  }, []);

  const insights = useMemo(() => {
    if (!insightInput) return [];
    return buildInsights(insightInput, "standard");
  }, [insightInput]);

  const banner = loading && progress
    ? {
        kind: "progress" as const,
        text: describeLoadProgress(progress),
      }
    : bootError
      ? { kind: "error" as const, text: bootError }
      : loadError
        ? { kind: "error" as const, text: loadError }
        : loadWarning
          ? { kind: "warn" as const, text: loadWarning }
          : null;

  const hasRows = rows.length > 0;

  return (
    <div className="app onesheet">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={16} />
          <div>
            <h1>Vehicle Metrics</h1>
            <p>Compact · one page</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="compact" />
          <ExportPdfButton disabled={!hasRows} />
          <div className="vehicle-chip">
            {selectedUser ? userLabel(selectedUser) : "No vehicle selected"}
            {selectedGroup ? ` · ${selectedGroup.name}` : ""}
          </div>
        </div>
      </header>

      <p className="print-meta">
        {selectedUser ? userLabel(selectedUser) : "No vehicle"}
        {selectedGroup ? ` · ${selectedGroup.name}` : ""}
        {dateFrom && dateTo ? ` · ${dateFrom} → ${dateTo}` : ""}
        {timezone ? ` · ${timezone}` : ""}
        {period ? ` · ${period}` : ""}
      </p>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="c-group">Group</label>
            <select
              id="c-group"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setUserId("");
                setTrips(null);
              }}
            >
              <option value="">
                {bootError ? "Groups unavailable" : groups.length ? "Select a group" : "Loading groups…"}
              </option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupOptionLabel(group)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-user">Vehicle</label>
            <select
              id="c-user"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setTrips(null);
              }}
              disabled={!selectedGroup}
            >
              <option value="">{selectedGroup ? "Select a vehicle" : "Choose a group first"}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {userOptionLabel(user)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-from">From</label>
            <input
              id="c-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="c-to">To</label>
            <input
              id="c-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Period</label>
            <div className="period-switch" role="tablist" aria-label="Period">
              {(["daily", "weekly", "monthly"] as Period[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={period === item ? "active" : ""}
                  onClick={() => setPeriod(item)}
                >
                  {item[0].toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void handleLoad()}
            disabled={!userId || loading}
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </section>

        {banner && (
          <div className={`banner ${banner.kind === "progress" ? "progress" : banner.kind}`}>
            <span>{banner.text}</span>
            {banner.kind === "progress" && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            )}
          </div>
        )}

        <div className="kpi-toolbar no-print">
          <ExportExcelButton
            disabled={!trips || !hasRows}
            prefix="compact-kpis"
            sheetName="Summary"
            getRows={() => vehicleKpiSheet(totals)}
          />
        </div>

        <section className="kpis">
          <article className="kpi" style={{ ["--tick" as string]: "var(--gps)" }}>
            <div className="label">GPS</div>
            <div className="value">{trips ? formatKm(totals.gps) : "—"}</div>
            <div className="unit">km</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--ign)" }}>
            <div className="label">Ignition</div>
            <div className="value">{trips ? formatKm(totals.ignition) : "—"}</div>
            <div className="unit">km</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--odo)" }}>
            <div className="label">Odometer</div>
            <div className="value">{trips ? formatKm(totals.odometer) : "—"}</div>
            <div className="unit">km</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--hrs)" }}>
            <div className="label">Active</div>
            <div className="value">{trips ? formatHours(totals.hours) : "—"}</div>
            <div className="unit">hours</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "#c47d3a" }}>
            <div className="label">Idle</div>
            <div className="value">{trips ? formatHours(totals.idle) : "—"}</div>
            <div className="unit">
              {trips ? `${formatPct(movingSharePct(totals.hours, totals.idle))} moving` : "hours"}
            </div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--gps)" }}>
            <div className="label">Fuel</div>
            <div className="value">{trips ? formatLiters(totals.fuel) : "—"}</div>
            <div className="unit">
              {trips && totals.fuel > 0 ? `${formatKmPerL(totals.gps / totals.fuel)} km/l` : "L"}
            </div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--accent)" }}>
            <div className="label">Cost</div>
            <div className="value">{trips ? formatIdr(totals.cost) : "—"}</div>
            <div className="unit">IDR</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--danger)" }}>
            <div className="label">Safety</div>
            <div className="value">{behavior ? behavior.safetyScore.toFixed(0) : "—"}</div>
            <div className="unit">{behavior ? `${behavior.eventsPer100km.toFixed(1)} / 100 km` : "score"}</div>
          </article>
        </section>

        {!hasRows ? (
          <div className="empty onesheet-empty">
            <div>
              <div className="route-glyph" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                  <path
                    d="M5 19c4-9 6.5-13 8-13s4 4 8 13"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <circle cx="13" cy="19" r="2" fill="currentColor" />
                </svg>
              </div>
              <h3>{trips ? "No points in this range" : "Load a vehicle to see activity"}</h3>
              <p>
                Same metrics as the full dashboard, fitted to one screen. Choose a vehicle and load, or
                open Full view for charts, map, table, and AI.
              </p>
            </div>
          </div>
        ) : (
          <div className="onesheet-grid">
            <section className="panel onesheet-cell">
              <div className="panel-head">
                <h2>Distance</h2>
                <div className="panel-head-aside">
                  <div className="legend">
                    <span>
                      <i className="swatch" style={{ background: "var(--gps)" }} /> GPS
                    </span>
                    <span>
                      <i className="swatch" style={{ background: "var(--ign)" }} /> Ign
                    </span>
                    <span>
                      <i className="swatch" style={{ background: "var(--odo)" }} /> Odo
                    </span>
                  </div>
                  <ExportExcelButton
                    disabled={rows.length === 0}
                    prefix="compact-distance"
                    sheetName="Distance"
                    getRows={() => periodDistanceSheet(rows)}
                  />
                </div>
              </div>
              <DistanceChart rows={rows} />
            </section>

            <section className="panel onesheet-cell">
              <div className="panel-head">
                <h2>Utilization</h2>
                <div className="panel-head-aside">
                  <div className="legend">
                    <span>
                      <i className="swatch" style={{ background: "var(--gps)" }} /> Active
                    </span>
                    <span>
                      <i className="swatch" style={{ background: "#c47d3a" }} /> Idle
                    </span>
                  </div>
                  <ExportExcelButton
                    disabled={rows.length === 0}
                    prefix="compact-utilization"
                    sheetName="Utilization"
                    getRows={() => periodUtilizationSheet(rows)}
                  />
                </div>
              </div>
              <UtilizationChart rows={rows} />
            </section>

            <section className="panel onesheet-cell">
              <div className="panel-head">
                <h2>Fuel</h2>
                <div className="panel-head-aside">
                  <div className="legend">
                    <span>
                      <i className="swatch" style={{ background: "var(--gps)" }} /> CAN
                    </span>
                    <span>
                      <i className="swatch" style={{ background: "var(--odo)" }} /> Tank
                    </span>
                  </div>
                  <ExportExcelButton
                    disabled={rows.length === 0}
                    prefix="compact-fuel"
                    sheetName="Fuel"
                    getRows={() => periodFuelSheet(rows)}
                  />
                </div>
              </div>
              <FuelChart rows={rows} />
            </section>

            <section className="panel onesheet-cell onesheet-analysis">
              <div className="panel-head">
                <h2>Analysis</h2>
                <div className="panel-head-aside">
                  <ExportExcelButton
                    disabled={insights.length === 0}
                    prefix="compact-analysis"
                    sheetName="Analysis"
                    getRows={() => insightsSheet(insights)}
                  />
                </div>
              </div>
              <div className="insight-stack">
                {insights.map((block) => (
                  <article key={block.id} className="insight-item">
                    <h3>{block.title}</h3>
                    <p>{block.body}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel onesheet-cell">
              <div className="panel-head">
                <h2>Speed &amp; RPM</h2>
                <div className="panel-head-aside">
                  <div className="legend">
                    <span>
                      <i className="swatch line" style={{ background: "var(--gps)" }} /> Speed
                    </span>
                    <span>
                      <i className="swatch line" style={{ background: "var(--odo)" }} /> RPM
                    </span>
                  </div>
                  <ExportExcelButton
                    disabled={rows.length === 0}
                    prefix="compact-speed-rpm"
                    sheetName="Speed RPM"
                    getRows={() => periodSpeedRpmSheet(rows)}
                  />
                </div>
              </div>
              <SpeedRpmChart rows={rows} />
            </section>

            <section className="panel onesheet-cell onesheet-snapshot">
              <div className="panel-head">
                <h2>Snapshot</h2>
                <div className="panel-head-aside">
                  <ExportExcelButton
                    disabled={!hasRows}
                    prefix="compact-snapshot"
                    sheetName="Snapshot"
                    getRows={() =>
                      compactSnapshotSheet(totals, [
                        ["Elevation gain m", totals.altitudeSamples > 0 ? Math.round(totals.elevationGainM) : ""],
                        ["Elevation loss m", totals.altitudeSamples > 0 ? Math.round(totals.elevationLossM) : ""],
                        ["Terrain impact %", totals.terrainImpactPct > 0 ? Math.round(totals.terrainImpactPct * 10) / 10 : ""],
                        ["Flat km/l", totals.flatKmPerL > 0 ? Math.round(totals.flatKmPerL * 100) / 100 : ""],
                        ["Road smooth %", totals.roadSamples > 0 ? Math.round(totals.roadSmoothPct * 10) / 10 : ""],
                        ["Road bumpy %", totals.roadSamples > 0 ? Math.round(totals.roadBumpyPct * 10) / 10 : ""],
                        ["Harsh braking", behavior?.harshBraking ?? ""],
                        ["Harsh acceleration", behavior?.harshAcceleration ?? ""],
                        ["Harsh cornering", behavior?.harshCornering ?? ""],
                        ["Overspeed", behavior?.overspeed ?? ""],
                        ["Top issue", behavior?.topIssue ?? "None"],
                      ])
                    }
                  />
                </div>
              </div>
              <div className="onesheet-tiles">
                <div className="mini-stat">
                  <div className="l">Avg / max speed</div>
                  <div className="v">
                    {totals.avgSpeed > 0 ? formatSpeed(totals.avgSpeed) : "—"} /{" "}
                    {totals.maxSpeed > 0 ? formatSpeed(totals.maxSpeed) : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">Avg / max RPM</div>
                  <div className="v">
                    {totals.avgRpm > 0 ? formatRpm(totals.avgRpm) : "—"} /{" "}
                    {totals.maxRpm > 0 ? formatRpm(totals.maxRpm) : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">CAN / tank</div>
                  <div className="v">
                    {totals.canFuel > 0 ? `${formatLiters(totals.canFuel)} L` : "—"} /{" "}
                    {totals.tankFuel > 0 ? `${formatLiters(totals.tankFuel)} L` : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">Elevation</div>
                  <div className="v">
                    {totals.altitudeSamples > 0
                      ? `${formatMeters(totals.elevationGainM)} / ${formatMeters(totals.elevationLossM)}`
                      : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">Terrain / flat km/l</div>
                  <div className="v">
                    {totals.terrainImpactPct > 0 ? formatPct(totals.terrainImpactPct) : "—"} /{" "}
                    {totals.flatKmPerL > 0 ? formatKmPerL(totals.flatKmPerL) : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">Road smooth / bumpy</div>
                  <div className="v">
                    {totals.roadSamples > 0
                      ? `${formatPct(totals.roadSmoothPct)} / ${formatPct(totals.roadBumpyPct)}`
                      : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">Brake / accel / corner</div>
                  <div className="v">
                    {behavior
                      ? `${behavior.harshBraking} / ${behavior.harshAcceleration} / ${behavior.harshCornering}`
                      : "—"}
                  </div>
                </div>
                <div className="mini-stat">
                  <div className="l">Overspeed / top issue</div>
                  <div className="v">
                    {behavior ? `${behavior.overspeed} · ${behavior.topIssue ?? "None"}` : "—"}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
