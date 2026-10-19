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
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import {
  IcoAlerts,
  IcoAttention,
  IcoCover,
  IcoFleet,
  IcoFuel,
  IcoOdo,
  IcoProtocol,
  IcoUtil,
  IcoWrench,
} from "./fleetLiveIcons";

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
    <div className="fleet-sec fleet-dash">
      <FleetLiveSectionHead
        section="dashboard"
        title="Dashboard"
        subtitle={loading ? "Updating live snapshot…" : "Live utilization from last status"}
      />

      <section className="fleet-dash-kpis" aria-label="Dashboard KPIs">
        <div className="fleet-dash-kpi" title="Fleet size">
          <span>
            <IcoFleet /> Fleet
          </span>
          <strong>{kpi.total}</strong>
          <em className="muted">devices</em>
        </div>
        <div className="fleet-dash-kpi is-util" title="Moving / online">
          <span>
            <IcoUtil /> Util
          </span>
          <strong>{utilizationPct}%</strong>
          <em className="muted">
            {kpi.moving}/{online} online
          </em>
        </div>
        <div className="fleet-dash-kpi" title="Non-stale coverage">
          <span>
            <IcoCover /> Cover
          </span>
          <strong>{coveragePct}%</strong>
          <em className="muted">{kpi.stale} stale</em>
        </div>
        <div className="fleet-dash-kpi is-alert" title="Units with alerts (24h)">
          <span>
            <IcoAlerts /> Alerts
          </span>
          <strong>{kpi.alerts}</strong>
          <em className="muted">units · 24h</em>
        </div>
        <div className="fleet-dash-kpi is-maint" title="Open maintenance">
          <span>
            <IcoWrench /> Maint
          </span>
          <strong>{kpi.maintenance}</strong>
          <em className="muted">
            <a href={maintenanceHref}>board</a>
          </em>
        </div>
        <div className="fleet-dash-kpi" title="Average fuel level">
          <span>
            <IcoFuel /> Fuel
          </span>
          <strong>{kpi.avgFuel != null ? `${kpi.avgFuel}%` : "—"}</strong>
          <em className="muted">
            ↓{fuelStats.low} · ~{fuelStats.mid} · ↑{fuelStats.high}
          </em>
        </div>
        <div className="fleet-dash-kpi" title="Sum of odometer readings">
          <span>
            <IcoOdo /> Odo
          </span>
          <strong>{odoTotal.n ? formatKm(odoTotal.sum) : "—"}</strong>
          <em className="muted">{odoTotal.n ? `${odoTotal.n} units` : "no data"}</em>
        </div>
      </section>

      <div className="fleet-dash-grid">
        <section className="fleet-dash-card">
          <h3>
            <IcoUtil /> Status
          </h3>
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
          <h3>
            <IcoAlerts /> Alerts · 24h
          </h3>
          {alertByType.length === 0 ? (
            <p className="muted fleet-dash-empty">No safety events.</p>
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
          <h3>
            <IcoProtocol /> Protocol
          </h3>
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
          <h3>
            <IcoAttention /> Attention
          </h3>
          {attention.length === 0 ? (
            <p className="muted fleet-dash-empty">All clear.</p>
          ) : (
            <ul className="fleet-dash-attn-list">
              {attention.map((item) => (
                <li key={item.id}>
                  <button type="button" className="btn-link" onClick={() => onOpenLive(item.id)}>
                    {item.name}
                  </button>
                  <span className="fleet-dash-attn-flags">
                    {item.reasons.includes("Alert 24h") ? (
                      <span className="fleet-cc-chip is-alert" title="Alert 24h">
                        <IcoAlerts />
                      </span>
                    ) : null}
                    {item.reasons.some((r) => r === "Maintenance") ? (
                      <span className="fleet-cc-chip is-maint" title="Maintenance">
                        <IcoWrench />
                      </span>
                    ) : null}
                    {item.reasons.some((r) => r === LIVE_OPS_LABELS.stale || r === LIVE_OPS_LABELS.noFix) ? (
                      <span
                        className="fleet-cc-stat-dot"
                        title={item.reasons.find((r) => r === LIVE_OPS_LABELS.stale || r === LIVE_OPS_LABELS.noFix)}
                        style={{ background: LIVE_OPS_COLORS.stale }}
                      />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="fleet-dash-card">
        <h3>
          <IcoFleet /> Snapshot
        </h3>
        <div className="fleet-dash-table-wrap">
          <table className="fleet-dash-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th title="Status">●</th>
                <th title="Age">Age</th>
                <th title="Fuel">
                  <IcoFuel />
                </th>
                <th title="Odometer">
                  <IcoOdo />
                </th>
                <th title="Flags">!</th>
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
                  const inAlert = Boolean(meta && alertDeviceIds.has(meta.deviceId));
                  const inMaint = row.id > 0 && maintUserIds.has(row.id);
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
                          title={LIVE_OPS_LABELS[cls]}
                          style={{ background: LIVE_OPS_COLORS[cls] }}
                        />
                      </td>
                      <td>{ageLabel(row.lastMs, now)}</td>
                      <td>
                        {meta?.fuelLevel != null ? `${Math.round(meta.fuelLevel)}%` : "—"}
                      </td>
                      <td>
                        {meta?.odometerKm != null ? `${formatKm(meta.odometerKm)}` : "—"}
                      </td>
                      <td className="fleet-dash-flags">
                        {inAlert ? (
                          <span className="fleet-cc-chip is-alert" title="Alert">
                            <IcoAlerts />
                          </span>
                        ) : null}
                        {inMaint ? (
                          <span className="fleet-cc-chip is-maint" title="Maint">
                            <IcoWrench />
                          </span>
                        ) : null}
                        {!inAlert && !inMaint ? <span className="muted">—</span> : null}
                      </td>
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
