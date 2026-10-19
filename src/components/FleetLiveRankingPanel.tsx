import { useMemo, useState } from "react";
import { formatKm, formatSpeed } from "../lib/format";
import { ageLabel, type LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
} from "../lib/liveOps";
import type { FleetDashFixMeta } from "./FleetLiveDashboardPanel";

type SortKey = "name" | "status" | "speed" | "odometer" | "fuel" | "alerts" | "age";

type Props = {
  rows: LastStatusRow[];
  fixMeta: Record<number, FleetDashFixMeta>;
  alertDeviceIds: Set<string>;
  alertCounts: Record<string, number>;
  maintUserIds: Set<number>;
  now: number;
  loading: boolean;
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
  onOpenLive,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("odometer");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

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
        inMaint: row.id > 0 && maintUserIds.has(row.id),
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

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "status" || key === "age" ? "asc" : "desc");
    }
  };

  const sortMark = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="fleet-rank">
      <header className="fleet-rank-head">
        <div>
          <h2>Ranking</h2>
          <p className="muted">
            Leaderboard from live last-status
            {loading ? " · updating…" : ""} · sort by column
          </p>
        </div>
      </header>

      <div className="fleet-rank-table-wrap">
        <table className="fleet-rank-table">
          <thead>
            <tr>
              <th className="fleet-rank-pos">#</th>
              <th>
                <button type="button" className="fleet-rank-sort" onClick={() => toggleSort("name")}>
                  Vehicle{sortMark("name")}
                </button>
              </th>
              <th>
                <button type="button" className="fleet-rank-sort" onClick={() => toggleSort("status")}>
                  Status{sortMark("status")}
                </button>
              </th>
              <th>
                <button type="button" className="fleet-rank-sort" onClick={() => toggleSort("speed")}>
                  Speed{sortMark("speed")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className="fleet-rank-sort"
                  onClick={() => toggleSort("odometer")}
                >
                  Odometer{sortMark("odometer")}
                </button>
              </th>
              <th>
                <button type="button" className="fleet-rank-sort" onClick={() => toggleSort("fuel")}>
                  Fuel{sortMark("fuel")}
                </button>
              </th>
              <th>
                <button type="button" className="fleet-rank-sort" onClick={() => toggleSort("alerts")}>
                  Alerts 24h{sortMark("alerts")}
                </button>
              </th>
              <th>
                <button type="button" className="fleet-rank-sort" onClick={() => toggleSort("age")}>
                  Age{sortMark("age")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  {loading ? "Loading…" : "No devices in this group."}
                </td>
              </tr>
            ) : (
              ranked.map((item, idx) => (
                <tr key={item.row.id} className={item.inAlert ? "is-alert" : ""}>
                  <td className="fleet-rank-pos">{idx + 1}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => onOpenLive(item.row.id)}
                    >
                      {item.row.name}
                    </button>
                    {item.inMaint ? <span className="fleet-cc-chip is-maint">Maint</span> : null}
                  </td>
                  <td>
                    <span
                      className="fleet-dash-status-dot"
                      style={{ background: LIVE_OPS_COLORS[item.cls] }}
                    />
                    {LIVE_OPS_LABELS[item.cls]}
                  </td>
                  <td>
                    {item.row.speedKmh == null ? "—" : `${formatSpeed(item.row.speedKmh)} km/h`}
                  </td>
                  <td>{item.odo != null ? `${formatKm(item.odo)} km` : "—"}</td>
                  <td>{item.fuel != null ? `${Math.round(item.fuel)}%` : "—"}</td>
                  <td>
                    <strong className={item.alerts > 0 ? "fleet-rank-alert-n" : ""}>
                      {item.alerts}
                    </strong>
                  </td>
                  <td>{ageLabel(item.row.lastMs, now)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
