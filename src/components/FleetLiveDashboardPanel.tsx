import { useMemo } from "react";
import { formatKm } from "../lib/format";
import { ageLabel, type LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  countLiveByClass,
  LIVE_OPS_CLASSES,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
} from "../lib/liveOps";

export type FleetDashFixMeta = {
  deviceId: string;
  imei: string;
  odometerKm: number | null;
  fuelLevel: number | null;
  fuelLiters: number | null;
  groups: string;
  protocol: string;
};

export type FleetDashAlert = {
  id: string;
  deviceId: string;
  deviceLabel?: string;
  alarmType: string;
  alarmLevel: number;
  recordedAt: string;
};

type Props = {
  rows: LastStatusRow[];
  fixMeta: Record<number, FleetDashFixMeta>;
  alerts: FleetDashAlert[];
  maintUserIds: Set<number>;
  alertDeviceIds: Set<string>;
  now: number;
  loading: boolean;
  onOpenLive: (vehicleId: number) => void;
  maintenanceHref: string;
};

function alarmLabel(type: string): string {
  const t = (type || "").trim();
  if (!t) return "Alarm";
  return t.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function FleetLiveDashboardPanel({
  rows,
  fixMeta,
  alerts,
  maintUserIds,
  alertDeviceIds,
  now,
  loading,
  onOpenLive,
  maintenanceHref,
}: Props) {
  const counts = useMemo(() => countLiveByClass(rows, now), [rows, now]);

  const kpi = useMemo(() => {
    let fuelSum = 0;
    let fuelN = 0;
    let alertUnits = 0;
    let maintUnits = 0;
    for (const row of rows) {
      const meta = fixMeta[row.id];
      if (meta?.fuelLevel != null && Number.isFinite(meta.fuelLevel)) {
        fuelSum += meta.fuelLevel;
        fuelN += 1;
      }
      if (meta && alertDeviceIds.has(meta.deviceId)) alertUnits += 1;
      if (row.id > 0 && maintUserIds.has(row.id)) maintUnits += 1;
    }
    return {
      total: rows.length,
      moving: counts.moving,
      idle: counts.idle,
      off: counts.off,
      stale: counts.stale + counts.noFix,
      alerts: alertUnits,
      maintenance: maintUnits,
      avgFuel: fuelN ? Math.round(fuelSum / fuelN) : null,
    };
  }, [rows, counts, fixMeta, alertDeviceIds, maintUserIds]);

  const online = kpi.moving + kpi.idle;
  const utilizationPct = online ? Math.round((kpi.moving / online) * 100) : 0;
  const coveragePct = kpi.total ? Math.round(((kpi.total - kpi.stale) / kpi.total) * 100) : 0;

  const statusBreakdown = useMemo(
    () =>
      LIVE_OPS_CLASSES.map((cls) => ({
        cls,
        n: counts[cls],
        pct: rows.length ? Math.round((counts[cls] / rows.length) * 100) : 0,
      })),
    [counts, rows.length],
  );

  const alertByType = useMemo(() => {
    const recent = now - 24 * 60 * 60 * 1000;
    const map = new Map<string, number>();
    for (const a of alerts) {
      const t = Date.parse(a.recordedAt);
      if (!Number.isFinite(t) || t < recent) continue;
      const key = a.alarmType || "unknown";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .map(([type, n]) => ({ type, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
  }, [alerts, now]);

  const protocolMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const p = (fixMeta[row.id]?.protocol || "unknown").toLowerCase() || "unknown";
      map.set(p, (map.get(p) || 0) + 1);
    }
    return [...map.entries()]
      .map(([protocol, n]) => ({ protocol, n }))
      .sort((a, b) => b.n - a.n);
  }, [rows, fixMeta]);

  const attention = useMemo(() => {
    const list: Array<{
      id: number;
      name: string;
      reasons: string[];
      cls: string;
    }> = [];
    for (const row of rows) {
      const meta = fixMeta[row.id];
      const cls = classifyLiveRow(row, now);
      const reasons: string[] = [];
      if (cls === "stale" || cls === "noFix") reasons.push(LIVE_OPS_LABELS[cls]);
      if (meta && alertDeviceIds.has(meta.deviceId)) reasons.push("Alert 24h");
      if (row.id > 0 && maintUserIds.has(row.id)) reasons.push("Maintenance");
      if (!reasons.length) continue;
      list.push({ id: row.id, name: row.name, reasons, cls });
    }
    return list.slice(0, 12);
  }, [rows, fixMeta, now, alertDeviceIds, maintUserIds]);

  const fuelStats = useMemo(() => {
    let low = 0;
    let mid = 0;
    let high = 0;
    let unknown = 0;
    for (const row of rows) {
      const f = fixMeta[row.id]?.fuelLevel;
      if (f == null || !Number.isFinite(f)) {
        unknown += 1;
        continue;
      }
      if (f < 20) low += 1;
      else if (f < 50) mid += 1;
      else high += 1;
    }
    return { low, mid, high, unknown };
  }, [rows, fixMeta]);

  const odoTotal = useMemo(() => {
    let sum = 0;
    let n = 0;
    for (const row of rows) {
      const o = fixMeta[row.id]?.odometerKm;
      if (o != null && Number.isFinite(o)) {
        sum += o;
        n += 1;
      }
    }
    return { sum, n };
  }, [rows, fixMeta]);

  return (
    <div className="fleet-dash">
      <header className="fleet-dash-head">
        <div>
          <h2>Dashboard</h2>
          <p className="muted">
            Live utilization from last status
            {loading ? " · updating…" : ""}
          </p>
        </div>
      </header>

      <section className="fleet-dash-kpis" aria-label="Dashboard KPIs">
        <div className="fleet-dash-kpi">
          <span>Fleet</span>
          <strong>{kpi.total}</strong>
          <em className="muted">devices</em>
        </div>
        <div className="fleet-dash-kpi is-util">
          <span>Utilization</span>
          <strong>{utilizationPct}%</strong>
          <em className="muted">
            {kpi.moving} moving / {online} online
          </em>
        </div>
        <div className="fleet-dash-kpi">
          <span>Coverage</span>
          <strong>{coveragePct}%</strong>
          <em className="muted">{kpi.stale} stale / no fix</em>
        </div>
        <div className="fleet-dash-kpi is-alert">
          <span>Alerts 24h</span>
          <strong>{kpi.alerts}</strong>
          <em className="muted">units with events</em>
        </div>
        <div className="fleet-dash-kpi is-maint">
          <span>Maintenance</span>
          <strong>{kpi.maintenance}</strong>
          <em className="muted">
            <a href={maintenanceHref}>open board</a>
          </em>
        </div>
        <div className="fleet-dash-kpi">
          <span>Avg fuel</span>
          <strong>{kpi.avgFuel != null ? `${kpi.avgFuel}%` : "—"}</strong>
          <em className="muted">
            low {fuelStats.low} · mid {fuelStats.mid} · high {fuelStats.high}
          </em>
        </div>
        <div className="fleet-dash-kpi">
          <span>Odometer</span>
          <strong>{odoTotal.n ? formatKm(odoTotal.sum) : "—"}</strong>
          <em className="muted">{odoTotal.n ? `sum · ${odoTotal.n} units` : "no readings"}</em>
        </div>
      </section>

      <div className="fleet-dash-grid">
        <section className="fleet-dash-card">
          <h3>Status mix</h3>
          <ul className="fleet-dash-bars">
            {statusBreakdown.map(({ cls, n, pct }) => (
              <li key={cls}>
                <span className="fleet-dash-bar-label">
                  <i style={{ background: LIVE_OPS_COLORS[cls] }} />
                  {LIVE_OPS_LABELS[cls]}
                </span>
                <span className="fleet-dash-bar-track">
                  <span style={{ width: `${pct}%`, background: LIVE_OPS_COLORS[cls] }} />
                </span>
                <em>
                  {n} · {pct}%
                </em>
              </li>
            ))}
          </ul>
        </section>

        <section className="fleet-dash-card">
          <h3>Alerts by type (24h)</h3>
          {alertByType.length === 0 ? (
            <p className="muted fleet-dash-empty">No safety events in the last 24 hours.</p>
          ) : (
            <ul className="fleet-dash-list">
              {alertByType.map((row) => (
                <li key={row.type}>
                  <span>{alarmLabel(row.type)}</span>
                  <strong>{row.n}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fleet-dash-card">
          <h3>Protocol mix</h3>
          {protocolMix.length === 0 ? (
            <p className="muted fleet-dash-empty">No devices.</p>
          ) : (
            <ul className="fleet-dash-list">
              {protocolMix.map((row) => (
                <li key={row.protocol}>
                  <span>{row.protocol}</span>
                  <strong>
                    {row.n}
                    <em className="muted">
                      {" "}
                      · {kpi.total ? Math.round((row.n / kpi.total) * 100) : 0}%
                    </em>
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="fleet-dash-card fleet-dash-attention">
          <h3>Needs attention</h3>
          {attention.length === 0 ? (
            <p className="muted fleet-dash-empty">All clear — no stale, alert, or open maintenance units.</p>
          ) : (
            <ul className="fleet-dash-attn-list">
              {attention.map((item) => (
                <li key={item.id}>
                  <button type="button" className="btn-link" onClick={() => onOpenLive(item.id)}>
                    {item.name}
                  </button>
                  <span className="muted">{item.reasons.join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="fleet-dash-card">
        <h3>Fleet snapshot</h3>
        <div className="fleet-dash-table-wrap">
          <table className="fleet-dash-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Status</th>
                <th>Age</th>
                <th>Fuel</th>
                <th>Odo</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {loading ? "Loading…" : "No devices in this group."}
                  </td>
                </tr>
              ) : (
                rows.slice(0, 40).map((row) => {
                  const meta = fixMeta[row.id];
                  const cls = classifyLiveRow(row, now);
                  const flags: string[] = [];
                  if (meta && alertDeviceIds.has(meta.deviceId)) flags.push("Alert");
                  if (row.id > 0 && maintUserIds.has(row.id)) flags.push("Maint");
                  return (
                    <tr key={row.id}>
                      <td>
                        <button type="button" className="btn-link" onClick={() => onOpenLive(row.id)}>
                          {row.name}
                        </button>
                      </td>
                      <td>
                        <span
                          className="fleet-dash-status-dot"
                          style={{ background: LIVE_OPS_COLORS[cls] }}
                        />
                        {LIVE_OPS_LABELS[cls]}
                      </td>
                      <td>{ageLabel(row.lastMs, now)}</td>
                      <td>
                        {meta?.fuelLevel != null ? `${Math.round(meta.fuelLevel)}%` : "—"}
                      </td>
                      <td>
                        {meta?.odometerKm != null ? `${formatKm(meta.odometerKm)} km` : "—"}
                      </td>
                      <td className="muted">{flags.length ? flags.join(", ") : "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
