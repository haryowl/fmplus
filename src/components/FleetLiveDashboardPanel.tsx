import { useMemo, useState } from "react";
import { formatKm } from "../lib/format";
import { ageLabel, ageTone, type LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  countLiveByClass,
  LIVE_OPS_CLASSES,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
  type LiveOpsClass,
} from "../lib/liveOps";
import { FleetLiveSectionHead } from "./FleetLiveSectionHead";
import {
  IcoAlerts,
  IcoAttention,
  IcoCover,
  IcoFleet,
  IcoFuel,
  IcoHistory,
  IcoOdo,
  IcoProtocol,
  IcoSearch,
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

type SnapFilter = "all" | "idle" | "stale" | "alert";

const PROTO_COLORS = ["#0d9488", "#7c3aed", "#2563eb", "#db2777", "#ca8a04", "#64748b"];

function alarmLabel(type: string): string {
  const t = (type || "").trim();
  if (!t) return "Alarm";
  return t.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function Spark({ values, tone = "ok" }: { values: number[]; tone?: "ok" | "warn" | "bad" }) {
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * 48;
      const y = 16 - (v / max) * 14;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className={`fleet-dash-spark is-${tone}`} viewBox="0 0 48 18" width="48" height="18" aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function Donut({
  segments,
  center,
  sub,
}: {
  segments: Array<{ color: string; pct: number; key: string }>;
  center: string;
  sub?: string;
}) {
  const r = 34;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = segments
    .filter((s) => s.pct > 0)
    .map((s) => {
      const len = (s.pct / 100) * c;
      const arc = { ...s, dash: `${len} ${c - len}`, offset };
      offset -= len;
      return arc;
    });
  return (
    <div className="fleet-dash-donut">
      <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--line, #d5e0e6)" strokeWidth="10" />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth="10"
            strokeDasharray={arc.dash}
            strokeDashoffset={arc.offset}
            transform="rotate(-90 48 48)"
          />
        ))}
      </svg>
      <div className="fleet-dash-donut-label">
        <strong>{center}</strong>
        {sub ? <span>{sub}</span> : null}
      </div>
    </div>
  );
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
  const [snapFilter, setSnapFilter] = useState<SnapFilter>("all");
  const [snapQuery, setSnapQuery] = useState("");

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
      live: counts.moving + counts.idle + counts.off,
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

  const dominantStatus = useMemo(() => {
    let best = statusBreakdown[0];
    for (const row of statusBreakdown) {
      if (row.n > (best?.n || 0)) best = row;
    }
    return best;
  }, [statusBreakdown]);

  const alertByType = useMemo(() => {
    const recent = now - 24 * 60 * 60 * 1000;
    const map = new Map<string, number>();
    let total = 0;
    for (const a of alerts) {
      const t = Date.parse(a.recordedAt);
      if (!Number.isFinite(t) || t < recent) continue;
      const key = a.alarmType || "unknown";
      map.set(key, (map.get(key) || 0) + 1);
      total += 1;
    }
    const list = [...map.entries()]
      .map(([type, n]) => ({ type, n, pct: total ? Math.round((n / total) * 100) : 0 }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 6);
    return { list, total };
  }, [alerts, now]);

  const latestAlertByDevice = useMemo(() => {
    const recent = now - 24 * 60 * 60 * 1000;
    const map = new Map<string, FleetDashAlert>();
    for (const a of alerts) {
      const t = Date.parse(a.recordedAt);
      if (!Number.isFinite(t) || t < recent) continue;
      const prev = map.get(a.deviceId);
      if (!prev || Date.parse(prev.recordedAt) < t) map.set(a.deviceId, a);
    }
    return map;
  }, [alerts, now]);

  const protocolMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const p = (fixMeta[row.id]?.protocol || "unknown").toLowerCase() || "unknown";
      map.set(p, (map.get(p) || 0) + 1);
    }
    return [...map.entries()]
      .map(([protocol, n], i) => ({
        protocol,
        n,
        pct: kpi.total ? Math.round((n / kpi.total) * 100) : 0,
        color: PROTO_COLORS[i % PROTO_COLORS.length],
      }))
      .sort((a, b) => b.n - a.n);
  }, [rows, fixMeta, kpi.total]);

  const attention = useMemo(() => {
    const list: Array<{
      id: number;
      name: string;
      reasons: string[];
      cls: LiveOpsClass;
      detail: string;
    }> = [];
    for (const row of rows) {
      const meta = fixMeta[row.id];
      const cls = classifyLiveRow(row, now);
      const reasons: string[] = [];
      if (cls === "stale" || cls === "noFix") reasons.push(LIVE_OPS_LABELS[cls]);
      if (meta && alertDeviceIds.has(meta.deviceId)) reasons.push("Alert 24h");
      if (row.id > 0 && maintUserIds.has(row.id)) reasons.push("Maintenance");
      if (!reasons.length) continue;
      const latest = meta ? latestAlertByDevice.get(meta.deviceId) : undefined;
      const detail = latest
        ? alarmLabel(latest.alarmType)
        : reasons.filter((r) => r !== "Alert 24h").join(" · ") || "Needs review";
      list.push({ id: row.id, name: row.name, reasons, cls, detail });
    }
    return list.slice(0, 12);
  }, [rows, fixMeta, now, alertDeviceIds, maintUserIds, latestAlertByDevice]);

  const fuelStats = useMemo(() => {
    let low = 0;
    let mid = 0;
    let high = 0;
    for (const row of rows) {
      const f = fixMeta[row.id]?.fuelLevel;
      if (f == null || !Number.isFinite(f)) continue;
      if (f < 20) low += 1;
      else if (f < 50) mid += 1;
      else high += 1;
    }
    return { low, mid, high };
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

  const utilSpark = useMemo(
    () => [Math.max(0, utilizationPct - 18), Math.max(0, utilizationPct - 8), utilizationPct, Math.max(0, utilizationPct - 4), utilizationPct],
    [utilizationPct],
  );
  const coverSpark = useMemo(
    () => [Math.max(0, coveragePct - 12), Math.max(0, coveragePct - 5), coveragePct - 2, coveragePct, coveragePct],
    [coveragePct],
  );

  const snapRows = useMemo(() => {
    const q = snapQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const meta = fixMeta[row.id];
      const cls = classifyLiveRow(row, now);
      if (snapFilter === "idle" && cls !== "idle") return false;
      if (snapFilter === "stale" && cls !== "stale" && cls !== "noFix") return false;
      if (snapFilter === "alert" && !(meta && alertDeviceIds.has(meta.deviceId))) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        (meta?.imei && meta.imei.toLowerCase().includes(q))
      );
    });
  }, [rows, fixMeta, now, snapFilter, snapQuery, alertDeviceIds]);

  const utilBadge =
    utilizationPct >= 60 ? { text: "HIGH", tone: "ok" } : utilizationPct >= 25 ? { text: "MID", tone: "warn" } : { text: "LOW", tone: "warn" };
  const coverBadge = { text: `↗ ${coveragePct}%`, tone: coveragePct >= 70 ? "ok" : "warn" };
  const topProtocol = protocolMix[0];

  return (
    <div className="fleet-sec fleet-dash">
      <FleetLiveSectionHead
        section="dashboard"
        title="Dashboard"
        badge="LIVE"
        subtitle="Live utilization from last status"
        meta={
          <>
            <IcoHistory />
            {loading ? "Updating…" : "Updated just now"}
          </>
        }
      />

      <section className="fleet-dash-kpis" aria-label="Dashboard KPIs">
        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico">
              <IcoFleet />
            </span>
            <em className="fleet-dash-pill">Total</em>
          </header>
          <span className="fleet-dash-kpi-label">Fleet</span>
          <strong>{kpi.total}</strong>
          <p className="muted">devices · all registered</p>
        </article>

        <article className="fleet-dash-kpi is-util">
          <header>
            <span className="fleet-dash-kpi-ico is-util">
              <IcoUtil />
            </span>
            <em className={`fleet-dash-pill is-${utilBadge.tone}`}>{utilBadge.text}</em>
          </header>
          <span className="fleet-dash-kpi-label">Util</span>
          <strong>{utilizationPct}%</strong>
          <div className="fleet-dash-kpi-foot">
            <p className="muted">
              {kpi.moving}/{online || 0} online
            </p>
            <Spark values={utilSpark} tone={utilizationPct >= 25 ? "ok" : "warn"} />
          </div>
        </article>

        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-cover">
              <IcoCover />
            </span>
            <em className={`fleet-dash-pill is-${coverBadge.tone}`}>{coverBadge.text}</em>
          </header>
          <span className="fleet-dash-kpi-label">Cover</span>
          <strong>{coveragePct}%</strong>
          <div className="fleet-dash-kpi-foot">
            <p className="muted">
              {kpi.stale} stale · {kpi.live} live
            </p>
            <Spark values={coverSpark} tone={coveragePct >= 70 ? "ok" : "warn"} />
          </div>
        </article>

        <article className="fleet-dash-kpi is-alert">
          <header>
            <span className="fleet-dash-kpi-ico is-alert">
              <IcoAlerts />
            </span>
            <em className="fleet-dash-pill is-live">Live</em>
          </header>
          <span className="fleet-dash-kpi-label">Alerts</span>
          <strong>{kpi.alerts}</strong>
          <p className="muted">units · 24h</p>
          <div className="fleet-dash-kpi-bar">
            <span style={{ width: `${kpi.total ? Math.min(100, (kpi.alerts / kpi.total) * 100) : 0}%` }} />
          </div>
          <p className={`fleet-dash-kpi-note${kpi.alerts ? " is-warn" : ""}`}>
            {kpi.alerts ? "Needs review" : "All clear"}
          </p>
        </article>

        <article className="fleet-dash-kpi is-maint">
          <header>
            <span className="fleet-dash-kpi-ico is-maint">
              <IcoWrench />
            </span>
            <em className={`fleet-dash-pill is-${kpi.maintenance ? "warn" : "ok"}`}>
              {kpi.maintenance ? "OPEN" : "OK"}
            </em>
          </header>
          <span className="fleet-dash-kpi-label">Maint</span>
          <strong>{kpi.maintenance}</strong>
          <p className="muted">
            <a href={maintenanceHref}>board</a>
            {kpi.maintenance ? " · active tasks" : " · no active tasks"}
          </p>
        </article>

        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-fuel">
              <IcoFuel />
            </span>
            <em className="fleet-dash-pill">{kpi.avgFuel != null ? `${kpi.avgFuel}%` : "—"}</em>
          </header>
          <span className="fleet-dash-kpi-label">Fuel</span>
          <strong>{kpi.avgFuel != null ? `${kpi.avgFuel}%` : "—"}</strong>
          <p className="muted">
            ↓{fuelStats.low} · ~{fuelStats.mid} · ↑{fuelStats.high}
          </p>
        </article>

        <article className="fleet-dash-kpi">
          <header>
            <span className="fleet-dash-kpi-ico is-odo">
              <IcoOdo />
            </span>
            <em className="fleet-dash-pill">{odoTotal.n ? `${odoTotal.n} units` : "—"}</em>
          </header>
          <span className="fleet-dash-kpi-label">Odo</span>
          <strong>{odoTotal.n ? formatKm(odoTotal.sum) : "—"}</strong>
          <p className="muted">total km · tracked</p>
        </article>
      </section>

      <div className="fleet-dash-mid">
        <div className="fleet-dash-mid-col">
          <section className="fleet-dash-card">
            <header className="fleet-dash-card-head">
              <h3>
                <IcoUtil /> Status distribution
              </h3>
              {dominantStatus ? (
                <em className="fleet-dash-pill is-warn">{LIVE_OPS_LABELS[dominantStatus.cls]} dominant</em>
              ) : null}
            </header>
            <div className="fleet-dash-stack" aria-hidden>
              {statusBreakdown.map(({ cls, pct }) =>
                pct > 0 ? (
                  <span key={cls} style={{ width: `${pct}%`, background: LIVE_OPS_COLORS[cls] }} title={LIVE_OPS_LABELS[cls]} />
                ) : null,
              )}
            </div>
            <div className="fleet-dash-status-body">
              <Donut
                segments={statusBreakdown.map((s) => ({
                  key: s.cls,
                  color: LIVE_OPS_COLORS[s.cls],
                  pct: s.pct,
                }))}
                center={String(kpi.total)}
                sub="units"
              />
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
            </div>
          </section>

          <section className="fleet-dash-card">
            <header className="fleet-dash-card-head">
              <h3>
                <IcoProtocol /> Protocol mix
              </h3>
            </header>
            <div className="fleet-dash-proto-body">
              <Donut
                segments={protocolMix.map((p) => ({
                  key: p.protocol,
                  color: p.color,
                  pct: p.pct,
                }))}
                center={topProtocol ? `${topProtocol.pct}%` : "—"}
                sub={topProtocol?.protocol || "mix"}
              />
              <ul className="fleet-dash-proto-list">
                {protocolMix.length === 0 ? (
                  <li className="muted">No devices.</li>
                ) : (
                  protocolMix.map((row) => (
                    <li key={row.protocol}>
                      <span>
                        <i style={{ background: row.color }} />
                        {row.protocol}
                      </span>
                      <strong>
                        {row.pct}%
                        <em className="muted"> · {row.n}</em>
                      </strong>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </section>
        </div>

        <div className="fleet-dash-mid-col">
          <section className="fleet-dash-card">
            <header className="fleet-dash-card-head">
              <h3>
                <IcoAlerts /> Alerts · 24h
              </h3>
              {alertByType.total > 0 ? (
                <em className="fleet-dash-pill is-bad">
                  {alertByType.list[0] && alertByType.list[0].pct >= 40 ? "Critical volume" : `${alertByType.total} events`}
                </em>
              ) : (
                <em className="fleet-dash-pill is-ok">Quiet</em>
              )}
            </header>
            {alertByType.list.length === 0 ? (
              <p className="muted fleet-dash-empty">No safety events in the last 24 hours.</p>
            ) : (
              <ul className="fleet-dash-alert-cards">
                {alertByType.list.slice(0, 4).map((row, idx) => (
                  <li key={row.type} className={idx === 0 ? "is-critical" : "is-warn"}>
                    <div>
                      <strong>{alarmLabel(row.type)}</strong>
                      <span className="muted">{row.n} events</span>
                    </div>
                    <em>{row.pct}%</em>
                    <span className="fleet-dash-kpi-bar">
                      <span style={{ width: `${row.pct}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="fleet-dash-card fleet-dash-attention">
            <header className="fleet-dash-card-head">
              <h3>
                <IcoAttention /> Attention needed
              </h3>
              <em className={`fleet-dash-pill is-${attention.length ? "warn" : "ok"}`}>
                {attention.length} open
              </em>
            </header>
            {attention.length === 0 ? (
              <p className="muted fleet-dash-empty">All clear — no stale, alert, or open maintenance units.</p>
            ) : (
              <ul className="fleet-dash-attn-list">
                {attention.map((item) => (
                  <li key={item.id}>
                    <span className="fleet-dash-attn-avatar" style={{ background: LIVE_OPS_COLORS[item.cls] }}>
                      {initials(item.name)}
                    </span>
                    <div className="fleet-dash-attn-main">
                      <div className="fleet-dash-attn-title">
                        <strong>{item.name}</strong>
                        <span
                          className="fleet-dash-status-pill"
                          style={{
                            color: LIVE_OPS_COLORS[item.cls],
                            background: `color-mix(in srgb, ${LIVE_OPS_COLORS[item.cls]} 16%, transparent)`,
                          }}
                        >
                          {LIVE_OPS_LABELS[item.cls]}
                        </span>
                      </div>
                      <span className="muted">{item.detail}</span>
                    </div>
                    <button type="button" className="fleet-dash-investigate" onClick={() => onOpenLive(item.id)}>
                      Investigate
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="fleet-dash-card fleet-dash-snap">
        <header className="fleet-dash-card-head fleet-dash-snap-head">
          <div className="fleet-dash-snap-title">
            <h3>
              <IcoFleet /> Snapshot
            </h3>
            <em className="fleet-dash-pill">{snapRows.length} vehicles</em>
          </div>
          <div className="fleet-dash-snap-tools">
            <label className="fleet-dash-snap-search">
              <IcoSearch />
              <input
                type="search"
                value={snapQuery}
                onChange={(e) => setSnapQuery(e.target.value)}
                placeholder="Search vehicle…"
              />
            </label>
            <div className="fleet-ico-tabs" role="tablist">
              {(
                [
                  { id: "all" as const, label: "All" },
                  { id: "idle" as const, label: "Idle" },
                  { id: "stale" as const, label: "Stale" },
                  { id: "alert" as const, label: "Alert" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  className={snapFilter === tab.id ? "is-active" : ""}
                  aria-selected={snapFilter === tab.id}
                  onClick={() => setSnapFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="fleet-dash-table-wrap">
          <table className="fleet-dash-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Status</th>
                <th>Age</th>
                <th>
                  <IcoFuel /> Fuel
                </th>
                <th>
                  <IcoOdo /> Odo
                </th>
                <th>Alert</th>
              </tr>
            </thead>
            <tbody>
              {snapRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {loading ? "Loading…" : "No devices match this filter."}
                  </td>
                </tr>
              ) : (
                snapRows.slice(0, 50).map((row) => {
                  const meta = fixMeta[row.id];
                  const cls = classifyLiveRow(row, now);
                  const inAlert = Boolean(meta && alertDeviceIds.has(meta.deviceId));
                  const inMaint = row.id > 0 && maintUserIds.has(row.id);
                  const age = ageLabel(row.lastMs, now);
                  const tone = ageTone(row.lastMs, now);
                  const ageClass =
                    cls === "stale" || cls === "noFix" || tone === "stale"
                      ? "bad"
                      : tone === "live"
                        ? "ok"
                        : "warn";
                  return (
                    <tr key={row.id}>
                      <td>
                        <button type="button" className="fleet-dash-vehicle" onClick={() => onOpenLive(row.id)}>
                          <span className="fleet-dash-status-dot" style={{ background: LIVE_OPS_COLORS[cls] }} />
                          {row.name}
                        </button>
                      </td>
                      <td>
                        <span
                          className="fleet-dash-status-pill"
                          style={{
                            color: LIVE_OPS_COLORS[cls],
                            background: `color-mix(in srgb, ${LIVE_OPS_COLORS[cls]} 14%, transparent)`,
                          }}
                        >
                          {LIVE_OPS_LABELS[cls]}
                        </span>
                      </td>
                      <td>
                        <span className={`fleet-dash-age is-${ageClass}`}>{age}</span>
                      </td>
                      <td>
                        {meta?.fuelLevel != null ? `${Math.round(meta.fuelLevel)}%` : "—"}
                      </td>
                      <td>
                        {meta?.odometerKm != null ? `${formatKm(meta.odometerKm)} km` : "—"}
                      </td>
                      <td className="fleet-dash-flags">
                        {inAlert ? (
                          <span className="fleet-cc-chip is-alert" title="Alert 24h">
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

        <footer className="fleet-dash-snap-foot">
          <span className="muted">
            Last sync {loading ? "…" : "just now"} · {kpi.total} tracked · {snapRows.length} visible
          </span>
          <div className="fleet-dash-cover-meter" title={`Coverage ${coveragePct}%`}>
            <span>Coverage {coveragePct}%</span>
            <span className="fleet-dash-kpi-bar">
              <span style={{ width: `${coveragePct}%` }} />
            </span>
          </div>
        </footer>
      </section>
    </div>
  );
}
