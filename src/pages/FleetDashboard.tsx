import { memo, useState } from "react";
import { groupOptionLabel } from "../lib/api";
import { TIMEZONES } from "../lib/config";
import { seriesForPeriod, type FleetVehicleRow } from "../lib/fleet";
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
import { describeLoadProgress } from "../lib/dayTracks";
import { useFleetDashboard } from "../lib/useFleetDashboard";
import type { Period } from "../lib/types";
import { BrandMark } from "../components/BrandMark";
import { ExportExcelButton } from "../components/ExportExcelButton";
import { FleetBarChart } from "../components/FleetBarChart";
import { FleetHeadToHead } from "../components/FleetHeadToHead";
import { FleetRankTable } from "../components/FleetRankTable";
import { VehiclePicker } from "../components/VehiclePicker";
import { ExportPdfButton } from "../components/ExportPdfButton";
import { ViewNav } from "../components/ViewNav";
import type { InsightBlock } from "../lib/insight";
import {
  fleetDistanceByVehicleSheet,
  fleetDistanceOverTimeSheet,
  fleetEfficiencySheet,
  fleetFuelSheet,
  fleetKpiSheet,
  fleetRankSheet,
  fleetSafetySheet,
  fleetUtilizationSheet,
  insightsSheet,
} from "../lib/panelExcel";

export default function FleetDashboard() {
  const d = useFleetDashboard();
  const live = d.vehicles.filter((v) => v.hasData);
  const [baselineId, setBaselineId] = useState(0);
  const [compareId, setCompareId] = useState(0);

  const kmPerL = d.fleetFuel > 0 ? d.fleetGps / d.fleetFuel : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Fleet Metrics</h1>
            <p>Compare vehicles in a group · same range</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="fleet" />
          <ExportPdfButton disabled={live.length === 0} />
          <div className="vehicle-chip">
            {d.userIds.length
              ? `${d.userIds.length} vehicle${d.userIds.length === 1 ? "" : "s"}`
              : "No vehicles selected"}
            {d.selectedGroup ? ` · ${d.selectedGroup.name}` : ""}
          </div>
        </div>
      </header>

      <p className="print-meta">
        {d.userIds.length
          ? `${d.userIds.length} vehicle${d.userIds.length === 1 ? "" : "s"}`
          : "No vehicles"}
        {d.selectedGroup ? ` · ${d.selectedGroup.name}` : ""}
        {d.dateFrom && d.dateTo ? ` · ${d.dateFrom} → ${d.dateTo}` : ""}
        {d.timezone ? ` · ${d.timezone}` : ""}
        {d.period ? ` · ${d.period}` : ""}
      </p>

      <main className="shell">
        <section className="filters fleet-filters">
          <div className="field">
            <label htmlFor="f-group">Group</label>
            <select
              id="f-group"
              value={d.groupId}
              onChange={(e) => d.changeGroup(e.target.value)}
            >
              <option value="">
                {d.bootError ? "Groups unavailable" : d.groups.length ? "Select a group" : "Loading groups…"}
              </option>
              {d.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {groupOptionLabel(group)}
                </option>
              ))}
            </select>
          </div>
          <div className="field fleet-picker-field">
            <label>Vehicles</label>
            <VehiclePicker
              users={d.users}
              selectedIds={d.userIds}
              onChange={d.changeUserIds}
            />
          </div>
          <div className="field">
            <label htmlFor="f-from">From</label>
            <input
              id="f-from"
              type="date"
              value={d.dateFrom}
              onChange={(e) => d.setDateFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <input
              id="f-to"
              type="date"
              value={d.dateTo}
              onChange={(e) => d.setDateTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="f-tz">Timezone</label>
            <select
              id="f-tz"
              value={d.timezone}
              onChange={(e) => d.setTimezone(e.target.value)}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
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
            {d.loading ? "Loading…" : "Load comparison"}
          </button>
        </section>

        {d.bootError && <div className="banner error">{d.bootError}</div>}
        {d.loadError && !d.loading && <div className="banner error">{d.loadError}</div>}
        {d.loadWarning && !d.loading && !d.loadError && <div className="banner warn">{d.loadWarning}</div>}
        {d.loading && d.progress && (
          <div className="banner progress">
            <span>
              {describeLoadProgress(d.progress, d.userIds.length)}
            </span>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${d.progressPct}%` }} />
            </div>
          </div>
        )}

        <div className="kpi-toolbar no-print">
          <ExportExcelButton
            disabled={!d.byUserId || live.length === 0}
            prefix="fleet-kpi"
            sheetName="Fleet KPI"
            getRows={() =>
              fleetKpiSheet({
                vehicleCount: d.loadedCount,
                gpsKm: d.fleetGps,
                activeHours: d.fleetHours,
                idleHours: d.fleetIdle,
                fuelL: d.fleetFuel,
                cost: d.fleetCost,
              })
            }
          />
        </div>
        <section className="kpis">
          <article className="kpi" style={{ ["--tick" as string]: "var(--gps)" }}>
            <div className="label">Vehicles loaded</div>
            <div className="value">{d.byUserId ? formatInt(d.loadedCount) : "—"}</div>
            <div className="unit">of {d.userIds.length} selected</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--ign)" }}>
            <div className="label">Fleet GPS</div>
            <div className="value">{d.byUserId ? formatKm(d.fleetGps) : "—"}</div>
            <div className="unit">km combined</div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--hrs)" }}>
            <div className="label">Active time</div>
            <div className="value">{d.byUserId ? formatHours(d.fleetHours) : "—"}</div>
            <div className="unit">
              {d.byUserId ? `${formatPct(movingSharePct(d.fleetHours, d.fleetIdle))} moving` : "hours"}
            </div>
          </article>
          <article className="kpi" style={{ ["--tick" as string]: "var(--odo)" }}>
            <div className="label">Fleet fuel</div>
            <div className="value">{d.byUserId ? formatLiters(d.fleetFuel) : "—"}</div>
            <div className="unit">
              {d.byUserId && kmPerL > 0 ? `${formatKmPerL(kmPerL)} km/l · ${formatIdr(d.fleetCost)}` : "L"}
            </div>
          </article>
        </section>

        {live.length === 0 ? (
          <section className="panel">
            <div className="empty">
              <div>
                <h3>
                  {d.loading
                    ? "Loading fleet…"
                    : d.byUserId
                      ? "No points in this range"
                      : "Select vehicles to compare"}
                </h3>
                <p>
                  {d.loading
                    ? "Charts appear when the download finishes."
                    : "The last vehicle you opened on Full or Compact is selected by default. Tick more vehicles from the group, then load."}
                </p>
              </div>
            </div>
          </section>
        ) : (
          <FleetCharts
            vehicles={d.vehicles}
            periods={d.periods}
            insights={d.insights}
            baselineId={baselineId}
            compareId={compareId}
            onBaseline={setBaselineId}
            onCompare={setCompareId}
          />
        )}

        <footer className="foot">
          <span>
            {d.byUserId
              ? `${d.loadedCount} vehicles with trips · cap 8 per load`
              : "Query: groupId, userId (last used), userIds=1,2,3"}
          </span>
          <span>Same Armada metrics as the single-vehicle pages</span>
        </footer>
      </main>
    </div>
  );
}

const FleetCharts = memo(function FleetCharts({
  vehicles,
  periods,
  insights,
  baselineId,
  compareId,
  onBaseline,
  onCompare,
}: {
  vehicles: FleetVehicleRow[];
  periods: { key: string; label: string }[];
  insights: InsightBlock[];
  baselineId: number;
  compareId: number;
  onBaseline: (id: number) => void;
  onCompare: (id: number) => void;
}) {
  const live = vehicles.filter((v) => v.hasData);
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Distance by vehicle</h2>
            <p>GPS kilometres in the selected range. Use period grouping for the trend below.</p>
          </div>
          <div className="panel-head-aside">
            <Legend vehicles={live} />
            <ExportExcelButton
              disabled={live.length === 0}
              prefix="fleet-distance-by-vehicle"
              sheetName="Distance by vehicle"
              getRows={() => fleetDistanceByVehicleSheet(live)}
            />
          </div>
        </div>
        <FleetBarChart
          labels={live.map((v) => v.label)}
          series={[
            {
              label: "GPS km",
              data: live.map((v) => v.totals.gps),
              color: "#0b6b62",
            },
          ]}
          unit="km"
          yTitle="Distance (km)"
        />
      </section>

      {periods.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Distance over time</h2>
              <p>One line per vehicle. Periods with no trips for a vehicle show as zero.</p>
            </div>
            <div className="panel-head-aside">
              <Legend vehicles={live} />
              <ExportExcelButton
                disabled={live.length === 0}
                prefix="fleet-distance-over-time"
                sheetName="Distance over time"
                getRows={() => fleetDistanceOverTimeSheet(live)}
              />
            </div>
          </div>
          <FleetBarChart
            type="line"
            labels={periods.map((p) => p.label)}
            series={seriesForPeriod(live, periods, (row) => row.gpsDistanceKm).map((data, i) => ({
              label: live[i].label,
              color: live[i].color,
              data,
            }))}
            unit="km"
            yTitle="GPS km"
          />
        </section>
      )}

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Utilization</h2>
              <p>Engine-on hours split into moving versus idle.</p>
            </div>
            <ExportExcelButton
              disabled={live.length === 0}
              prefix="fleet-utilization"
              sheetName="Utilization"
              getRows={() => fleetUtilizationSheet(live)}
            />
          </div>
          <FleetBarChart
            labels={live.map((v) => v.label)}
            stacked
            series={[
              { label: "Active", data: live.map((v) => v.totals.hours), color: "#0b6b62" },
              { label: "Idle", data: live.map((v) => v.totals.idle), color: "#c47d3a" },
            ]}
            unit="h"
            yTitle="Hours"
          />
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Efficiency</h2>
              <p>GPS km per litre used for cost in this range.</p>
            </div>
            <ExportExcelButton
              disabled={live.length === 0}
              prefix="fleet-efficiency"
              sheetName="Efficiency"
              getRows={() => fleetEfficiencySheet(live)}
            />
          </div>
          <FleetBarChart
            labels={live.map((v) => v.label)}
            series={[
              {
                label: "km/l",
                data: live.map((v) => (v.totals.fuel > 0 ? v.totals.gps / v.totals.fuel : 0)),
                color: "#3b4cb3",
              },
            ]}
            unit="km/l"
            yTitle="km/l"
          />
        </section>
      </div>

      <div className="panel-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Fuel used</h2>
              <p>CAN and tank totals side by side per vehicle.</p>
            </div>
            <ExportExcelButton
              disabled={live.length === 0}
              prefix="fleet-fuel"
              sheetName="Fuel used"
              getRows={() => fleetFuelSheet(live)}
            />
          </div>
          <FleetBarChart
            labels={live.map((v) => v.label)}
            series={[
              { label: "CAN", data: live.map((v) => v.totals.canFuel), color: "#0b6b62" },
              { label: "Tank", data: live.map((v) => v.totals.tankFuel), color: "#9a3b12" },
            ]}
            unit="L"
            yTitle="Litres"
          />
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Safety events</h2>
              <p>Harsh brake, accel, corner, and overspeed counts.</p>
            </div>
            <ExportExcelButton
              disabled={live.length === 0}
              prefix="fleet-safety"
              sheetName="Safety events"
              getRows={() => fleetSafetySheet(live)}
            />
          </div>
          <FleetBarChart
            labels={live.map((v) => v.label)}
            series={[
              {
                label: "Braking",
                data: live.map((v) => v.behavior?.harshBraking ?? 0),
                color: "#9a3b12",
              },
              {
                label: "Accel",
                data: live.map((v) => v.behavior?.harshAcceleration ?? 0),
                color: "#c47d3a",
              },
              {
                label: "Corner",
                data: live.map((v) => v.behavior?.harshCornering ?? 0),
                color: "#3b4cb3",
              },
              {
                label: "Overspeed",
                data: live.map((v) => v.behavior?.overspeed ?? 0),
                color: "#9f2a2a",
              },
            ]}
            unit="events"
            yTitle="Events"
          />
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Ranking</h2>
            <p>Sort any column. Best and worst in that column are highlighted when the metric has a preferred direction.</p>
          </div>
          <ExportExcelButton
            disabled={live.length === 0}
            prefix="fleet-ranking"
            sheetName="Ranking"
            getRows={() => fleetRankSheet(live)}
          />
        </div>
        <FleetRankTable vehicles={vehicles} />
      </section>

      <FleetHeadToHead
        vehicles={vehicles}
        baselineId={baselineId}
        compareId={compareId}
        onBaseline={onBaseline}
        onCompare={onCompare}
      />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Fleet analysis</h2>
            <p>Template sentences from the same totals. Open a vehicle for the full single-vehicle briefing.</p>
          </div>
          <ExportExcelButton
            disabled={insights.length === 0}
            prefix="fleet-analysis"
            sheetName="Fleet analysis"
            getRows={() => insightsSheet(insights)}
          />
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
    </>
  );
});

function Legend({ vehicles }: { vehicles: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {vehicles.map((v) => (
        <span key={v.label}>
          <i className="swatch" style={{ background: v.color }} /> {v.label}
        </span>
      ))}
    </div>
  );
}
