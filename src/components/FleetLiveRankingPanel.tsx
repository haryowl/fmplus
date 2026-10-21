import { useMemo, useState } from "react";
import { useUnitSystem } from "../lib/unitSystem";
import {
  extraDisplayPinColumns,
  formatDisplayPinValue,
  readDisplayPin,
} from "../lib/fleetTelemetryParams";
import { ageLabel, ageTone, type LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
} from "../lib/liveOps";
import type { FleetDashFixMeta } from "./FleetLiveDashboardPanel";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import {
  IcoAlerts,
  IcoFuel,
  IcoHistory,
  IcoOdo,
  IcoRank,
  IcoSortAsc,
  IcoSortDesc,
  IcoSpeed,
  IcoWrench,
} from "./fleetLiveIcons";

type SortKey = "name" | "status" | "speed" | "odometer" | "fuel" | "alerts" | "age";

type Props = {
  rows: LastStatusRow[];
  fixMeta: Record<number, FleetDashFixMeta>;
  alertDeviceIds: Set<string>;
  alertCounts: Record<string, number>;
  maintUserIds: Set<number>;
  now: number;
  loading: boolean;
  displayPinIds?: string[];
  displayPinLabels?: Record<string, string>;
  onOpenLive: (vehicleId: number) => void;
};

const STATUS_RANK: Record<string, number> = {
  moving: 0,
  idle: 1,
  off: 2,
  stale: 3,
  noFix: 4,
};

export function FleetLiveRankingPanel({
  rows,
  fixMeta,
  alertDeviceIds,
  alertCounts,
  maintUserIds,
  now,
  loading,
  displayPinIds,
  displayPinLabels,
  onOpenLive,
}: Props) {
  const units = useUnitSystem();
  const [sortKey, setSortKey] = useState<SortKey>("odometer");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const pinColumns = useMemo(
    () => extraDisplayPinColumns(displayPinIds, displayPinLabels),
    [displayPinIds, displayPinLabels],
  );

  const ranked = useMemo(() => {
    const items = rows.map((row) => {
      const meta = fixMeta[row.id];
      const cls = classifyLiveRow(row, now);
      const deviceId = meta?.deviceId || "";
      return {
        row,
        meta,
        cls,
        alerts: deviceId ? alertCounts[deviceId] || 0 : 0,
        inAlert: Boolean(deviceId && alertDeviceIds.has(deviceId)),
        inMaint: maintUserIds.has(row.id),
        odo: meta?.odometerKm ?? null,
        fuel: meta?.fuelLevel ?? null,
        ageMs: row.lastMs != null ? Math.max(0, now - row.lastMs) : Number.POSITIVE_INFINITY,
      };
    });

    const dir = sortDir === "asc" ? 1 : -1;
    items.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.row.name.localeCompare(b.row.name);
          break;
        case "status":
          cmp = (STATUS_RANK[a.cls] ?? 9) - (STATUS_RANK[b.cls] ?? 9);
          break;
        case "speed":
          cmp = (a.row.speedKmh ?? -1) - (b.row.speedKmh ?? -1);
          break;
        case "odometer":
          cmp = (a.odo ?? -1) - (b.odo ?? -1);
          break;
        case "fuel":
          cmp = (a.fuel ?? -1) - (b.fuel ?? -1);
          break;
        case "alerts":
          cmp = a.alerts - b.alerts;
          break;
        case "age":
          cmp = a.ageMs - b.ageMs;
          break;
        default:
          cmp = 0;
      }
      if (cmp === 0) cmp = a.row.name.localeCompare(b.row.name);
      return cmp * dir;
    });
    return items;
  }, [rows, fixMeta, alertCounts, alertDeviceIds, maintUserIds, now, sortKey, sortDir]);

  const leaders = useMemo(() => {
    let topOdo = ranked[0] || null;
    let topSpeed = ranked[0] || null;
    let topAlerts = ranked[0] || null;
    for (const item of ranked) {
      if ((item.odo ?? -1) > (topOdo?.odo ?? -1)) topOdo = item;
      if ((item.row.speedKmh ?? -1) > (topSpeed?.row.speedKmh ?? -1)) topSpeed = item;
      if (item.alerts > (topAlerts?.alerts ?? -1)) topAlerts = item;
    }
    return { topOdo, topSpeed, topAlerts };
  }, [ranked]);

  const podium = ranked.slice(0, 3);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "status" || key === "age" ? "asc" : "desc");
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? <IcoSortAsc /> : <IcoSortDesc />;
  };

  return (
    <div className="fleet-sec fleet-rank">
      <FleetLiveSectionHead
        section="ranking"
        title="Ranking"
        badge="LIVE"
        subtitle={loading ? "Updating…" : "Leaderboard from live last-status"}
      />

      <div className="fleet-rank-kpis">
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-odo">
              <IcoOdo />
            </span>
            <em className="fleet-dash-pill">#1 odo</em>
          </header>
          <span className="fleet-dash-kpi-label">Distance</span>
          <strong>
            {leaders.topOdo?.odo != null ? units.distance(leaders.topOdo.odo, false) : "—"}
          </strong>
          <p className="muted">{leaders.topOdo?.row.name || "—"}</p>
        </article>
        <article className="fleet-dash-kpi is-util">
          <header>
            <span className="fleet-dash-kpi-ico is-util">
              <IcoSpeed />
            </span>
            <em className="fleet-dash-pill is-ok">Fastest</em>
          </header>
          <span className="fleet-dash-kpi-label">Speed</span>
          <strong>
            {units.speed(leaders.topSpeed?.row.speedKmh, false)}
            <em className="fleet-rank-unit"> {units.speedUnit}</em>
          </strong>
          <p className="muted">{leaders.topSpeed?.row.name || "—"}</p>
        </article>
        <article className="fleet-dash-kpi is-alert">
          <header>
            <span className="fleet-dash-kpi-ico is-alert">
              <IcoAlerts />
            </span>
            <em className="fleet-dash-pill is-live">24h</em>
          </header>
          <span className="fleet-dash-kpi-label">Events</span>
          <strong>{leaders.topAlerts?.alerts ?? 0}</strong>
          <p className="muted">{leaders.topAlerts?.row.name || "—"}</p>
        </article>
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico">
              <IcoRank />
            </span>
            <em className="fleet-dash-pill">{ranked.length} units</em>
          </header>
          <span className="fleet-dash-kpi-label">Sorted</span>
          <strong>{sortKey}</strong>
          <p className="muted">{sortDir === "asc" ? "ascending" : "descending"}</p>
        </article>
      </div>

      {podium.length > 0 ? (
        <div className="fleet-rank-podium" aria-label="Top 3">
          {podium.map((item, idx) => (
            <button
              key={item.row.id}
              type="button"
              className={`fleet-rank-podium-card is-p${idx + 1}`}
              onClick={() => onOpenLive(item.row.id)}
            >
              <span className="fleet-rank-medal">#{idx + 1}</span>
              <strong>{item.row.name}</strong>
              <span
                className="fleet-dash-status-pill"
                style={{
                  color: LIVE_OPS_COLORS[item.cls],
                  background: `color-mix(in srgb, ${LIVE_OPS_COLORS[item.cls]} 14%, transparent)`,
                }}
              >
                {LIVE_OPS_LABELS[item.cls]}
              </span>
              <span className="muted">
                {item.odo != null ? units.distance(item.odo) : "—"}
                {" · "}
                {units.speed(item.row.speedKmh)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="fleet-rank-table-wrap fleet-dash-card">
        <table className="fleet-rank-table">
          <thead>
            <tr>
              <th className="fleet-rank-pos">#</th>
              <th>
                <button type="button" className="fleet-rank-sort" onClick={() => toggleSort("name")}>
                  Vehicle {sortIcon("name")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="fleet-rank-sort"
                  title="Status"
                  onClick={() => toggleSort("status")}
                >
                  Status {sortIcon("status")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="fleet-rank-sort"
                  title="Speed"
                  onClick={() => toggleSort("speed")}
                >
                  <IcoSpeed /> {sortIcon("speed")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="fleet-rank-sort"
                  title="Odometer"
                  onClick={() => toggleSort("odometer")}
                >
                  <IcoOdo /> {sortIcon("odometer")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="fleet-rank-sort"
                  title="Fuel"
                  onClick={() => toggleSort("fuel")}
                >
                  <IcoFuel /> {sortIcon("fuel")}
                </button>
              </th>
              {pinColumns.map((col) => (
                <th key={col.id} title={`Mapper pin · ${col.id}`}>
                  {col.label}
                </th>
              ))}
              <th>
                <button
                  type="button"
                  className="fleet-rank-sort"
                  title="Events 24h"
                  onClick={() => toggleSort("alerts")}
                >
                  <IcoAlerts /> {sortIcon("alerts")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="fleet-rank-sort"
                  title="Age"
                  onClick={() => toggleSort("age")}
                >
                  <IcoHistory /> {sortIcon("age")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={8 + pinColumns.length} className="muted">
                  {loading ? "Loading…" : "No devices in this group."}
                </td>
              </tr>
            ) : (
              ranked.map((item, idx) => {
                const tone = ageTone(item.row.lastMs, now);
                const ageClass =
                  item.cls === "stale" || item.cls === "noFix" || tone === "stale"
                    ? "bad"
                    : tone === "live"
                      ? "ok"
                      : "warn";
                const pins = item.meta?.displayParams;
                return (
                  <tr key={item.row.id} className={item.inAlert ? "is-alert" : ""}>
                    <td className="fleet-rank-pos">{idx + 1}</td>
                    <td>
                      <button
                        type="button"
                        className="fleet-dash-vehicle"
                        onClick={() => onOpenLive(item.row.id)}
                      >
                        <span
                          className="fleet-dash-status-dot"
                          style={{ background: LIVE_OPS_COLORS[item.cls] }}
                        />
                        {item.row.name}
                      </button>
                      {item.inMaint ? (
                        <span className="fleet-cc-chip is-maint" title="Maintenance">
                          <IcoWrench />
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className="fleet-dash-status-pill"
                        style={{
                          color: LIVE_OPS_COLORS[item.cls],
                          background: `color-mix(in srgb, ${LIVE_OPS_COLORS[item.cls]} 14%, transparent)`,
                        }}
                      >
                        {LIVE_OPS_LABELS[item.cls]}
                      </span>
                    </td>
                    <td>{units.speed(item.row.speedKmh, false)}</td>
                    <td>{units.distance(item.odo, false)}</td>
                    <td>{item.fuel != null ? `${Math.round(item.fuel)}%` : "—"}</td>
                    {pinColumns.map((col) => (
                      <td key={col.id} className="fleet-dash-pin" title={col.id}>
                        {formatDisplayPinValue(readDisplayPin(pins, col))}
                      </td>
                    ))}
                    <td>
                      <strong className={item.alerts > 0 ? "fleet-rank-alert-n" : ""}>
                        {item.alerts}
                      </strong>
                    </td>
                    <td>
                      <span className={`fleet-dash-age is-${ageClass}`}>
                        {ageLabel(item.row.lastMs, now)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
