import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { DispatchLiveTimeline } from "../components/DispatchLiveTimeline";
import { ViewNav } from "../components/ViewNav";
import {
  fetchDispatchLive,
  formatServiceDateLabel,
  shiftServiceDate,
  todayServiceDate,
  type DispatchLiveDriver,
  type DispatchLiveSnapshot,
  type DispatchLiveStop,
  type DispatchLiveStopStatus,
} from "../lib/dispatch";
import { writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";

const POLL_MS = 20_000;

type TabId = "live" | "history";

function statusLabel(status: string): string {
  if (status === "delivered") return "Delivered";
  if (status === "in_transit") return "In transit";
  if (status === "delayed") return "Delayed";
  if (status === "skipped") return "Skipped";
  return "Pending";
}

function podLabel(pod: string): string {
  if (pod === "yes") return "Yes";
  if (pod === "pending") return "Pending";
  return "No";
}

function formatUpdatedAt(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function matchSearch(row: DispatchLiveStop, q: string): boolean {
  if (!q) return true;
  const hay = [
    row.externalRef,
    row.name,
    row.address,
    row.driverName,
    row.vehicleLabel,
    row.jobTitle,
    row.lat != null && row.lon != null ? `${row.lat},${row.lon}` : "",
    row.plannedLat != null && row.plannedLon != null ? `${row.plannedLat},${row.plannedLon}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

function statusTone(status: string): DispatchLiveStopStatus | "pending" {
  if (
    status === "delivered" ||
    status === "in_transit" ||
    status === "delayed" ||
    status === "skipped" ||
    status === "pending"
  ) {
    return status;
  }
  return "pending";
}

export default function DispatchLive() {
  const { ready, error: tenantError } = useEmbedTenant();
  const [tab, setTab] = useState<TabId>("live");
  const [serviceDate, setServiceDate] = useState(() => todayServiceDate());
  const [snapshot, setSnapshot] = useState<DispatchLiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [search, setSearch] = useState("");
  const [focusJobId, setFocusJobId] = useState<string | null>(null);
  const [focusStopId, setFocusStopId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    document.title = "Dispatch Live · ARMADA M.1";
  }, []);

  useEffect(() => {
    writeLocationSearch({ date: serviceDate || null });
  }, [serviceDate]);

  useEffect(() => {
    if (!ready || tab !== "live") return;
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    fetchDispatchLive(serviceDate, ac.signal)
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setFetchError("");
      })
      .catch((err: Error) => {
        if (cancelled || err.name === "AbortError") return;
        setFetchError(err.message || "Failed to load live dispatch");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [ready, serviceDate, tab, tick]);

  useEffect(() => {
    if (!ready || tab !== "live") return;
    const id = window.setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => window.clearInterval(id);
  }, [ready, tab, serviceDate]);

  useEffect(() => {
    if (!focusStopId) return;
    const el = document.querySelector(`[data-manifest-stop="${CSS.escape(focusStopId)}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusStopId, snapshot?.manifest]);

  const summary = snapshot?.summary;
  const drivers = snapshot?.drivers || [];

  const filteredManifest = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = snapshot?.manifest || [];
    if (focusJobId) rows = rows.filter((r) => r.jobId === focusJobId);
    if (q) rows = rows.filter((r) => matchSearch(r, q));
    return rows;
  }, [snapshot?.manifest, search, focusJobId]);

  const groupedManifest = useMemo(() => {
    const groups: { driver: DispatchLiveDriver | null; rows: DispatchLiveStop[] }[] = [];
    const byJob = new Map<string, DispatchLiveStop[]>();
    for (const row of filteredManifest) {
      const list = byJob.get(row.jobId) || [];
      list.push(row);
      byJob.set(row.jobId, list);
    }
    const order = focusJobId
      ? drivers.filter((d) => d.jobId === focusJobId)
      : drivers.filter((d) => byJob.has(d.jobId));
    for (const d of order) {
      const rows = byJob.get(d.jobId);
      if (rows?.length) groups.push({ driver: d, rows });
    }
    for (const [jobId, rows] of byJob) {
      if (order.some((d) => d.jobId === jobId)) continue;
      groups.push({ driver: null, rows });
    }
    return groups;
  }, [filteredManifest, drivers, focusJobId]);

  const bootError = tenantError || "";

  function clearFocus() {
    setFocusJobId(null);
    setFocusStopId(null);
  }

  function selectJob(jobId: string) {
    setFocusJobId((prev) => (prev === jobId && !focusStopId ? null : jobId));
    setFocusStopId(null);
  }

  function selectStop(jobId: string, stopId: string) {
    setFocusJobId(jobId);
    setFocusStopId((prev) => (prev === stopId ? null : stopId));
  }

  return (
    <div className="app dispatch-page dispatch-live-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Dispatch Live</h1>
            <p>Monitor execution · KPIs · drivers · progress · manifest</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchLive" />
          <div className="vehicle-chip">
            {tab === "live"
              ? loading && !snapshot
                ? "Loading…"
                : `${summary?.activeDrivers ?? 0} active`
              : "History"}
          </div>
        </div>
      </header>

      <main className="shell dispatch-shell dispatch-live-shell">
        <section className="dispatch-toolbar dispatch-live-toolbar" aria-label="Live monitoring controls">
          <div className="dispatch-live-tabs" role="tablist" aria-label="Dispatch monitoring">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "live"}
              className={tab === "live" ? "is-active" : ""}
              onClick={() => setTab("live")}
            >
              Live
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "history"}
              className={tab === "history" ? "is-active" : ""}
              onClick={() => setTab("history")}
            >
              History
            </button>
          </div>

          {tab === "live" ? (
            <>
              <div className="dispatch-date-nav" role="group" aria-label="Service date">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label="Previous day"
                  onClick={() => {
                    clearFocus();
                    setServiceDate((d) => shiftServiceDate(d, -1));
                  }}
                >
                  ‹
                </button>
                <label className="dispatch-date-field">
                  <span className="visually-hidden">Service date</span>
                  <input
                    type="date"
                    value={serviceDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                      clearFocus();
                      setServiceDate(v);
                    }}
                  />
                  <strong>{formatServiceDateLabel(serviceDate)}</strong>
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label="Next day"
                  onClick={() => {
                    clearFocus();
                    setServiceDate((d) => shiftServiceDate(d, 1));
                  }}
                >
                  ›
                </button>
                {serviceDate !== todayServiceDate() ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      clearFocus();
                      setServiceDate(todayServiceDate());
                    }}
                  >
                    Today
                  </button>
                ) : null}
              </div>

              <div className="dispatch-live-refresh">
                <span className="dispatch-live-updated">
                  Updated {formatUpdatedAt(snapshot?.updatedAt)} · auto {POLL_MS / 1000}s
                </span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading}
                  onClick={() => setTick((n) => n + 1)}
                >
                  Refresh
                </button>
              </div>
            </>
          ) : null}
        </section>

        {bootError ? <div className="dispatch-alert">{bootError}</div> : null}

        {tab === "history" ? (
          <section className="dispatch-live-history-stub panel" aria-label="History">
            <p className="dispatch-eyebrow">Coming next</p>
            <h2>History</h2>
            <p>
              Closed jobs, date-range filters, and export will land here. Use the Live tab for today’s
              monitoring.
            </p>
          </section>
        ) : (
          <>
            {fetchError ? <div className="dispatch-alert">{fetchError}</div> : null}

            <section className="dispatch-live-kpis" aria-label="Live summary">
              <article className="dispatch-live-kpi">
                <span>Stops</span>
                <strong>{summary?.totalStops ?? "—"}</strong>
              </article>
              <article className="dispatch-live-kpi">
                <span>In transit</span>
                <strong>{summary?.inTransit ?? "—"}</strong>
                <em>{summary ? `${summary.inTransitPct}%` : ""}</em>
              </article>
              <article className="dispatch-live-kpi tone-ok">
                <span>Delivered</span>
                <strong>{summary?.delivered ?? "—"}</strong>
              </article>
              <article className="dispatch-live-kpi">
                <span>Pending</span>
                <strong>{summary?.pending ?? "—"}</strong>
              </article>
              <article className={`dispatch-live-kpi${(summary?.delayed || 0) > 0 ? " tone-warn" : ""}`}>
                <span>Delayed</span>
                <strong>{summary?.delayed ?? "—"}</strong>
              </article>
              <article className="dispatch-live-kpi">
                <span>Avg complete</span>
                <strong>{summary ? `${summary.avgCompletion}%` : "—"}</strong>
                <em>
                  {summary?.skipped ? `${summary.skipped} skipped` : `${summary?.driverCount ?? 0} drivers`}
                </em>
              </article>
            </section>

            <section className="dispatch-live-drivers" aria-label="Drivers">
              <div className="dispatch-pane-head">
                <h2>Drivers</h2>
                {focusJobId ? (
                  <button type="button" className="btn-ghost" onClick={clearFocus}>
                    Clear focus
                  </button>
                ) : null}
              </div>
              {!loading && drivers.length === 0 ? (
                <p className="dispatch-live-empty">No assigned jobs for this date.</p>
              ) : (
                <div className="dispatch-live-driver-row">
                  {drivers.map((d) => {
                    const tone = statusTone(String(d.currentStatus));
                    const focused = focusJobId === d.jobId;
                    return (
                      <button
                        key={d.jobId}
                        type="button"
                        className={`dispatch-live-driver-card${focused ? " is-focused" : ""}`}
                        onClick={() => selectJob(d.jobId)}
                      >
                        <div className="dispatch-live-driver-top">
                          <span className="dispatch-live-avatar" aria-hidden>
                            {d.driverInitials}
                          </span>
                          <div>
                            <strong>{d.driverName}</strong>
                            <span>{d.vehicleLabel}</span>
                          </div>
                          <em className={`dispatch-live-pill tone-${tone}`}>{statusLabel(tone)}</em>
                        </div>
                        <div className="dispatch-live-driver-meta">
                          <span>
                            {d.doneCount}/{d.stopCount} stops · {d.pctComplete}%
                          </span>
                          <span>{d.timeWindowLabel}</span>
                        </div>
                        <div className="dispatch-live-progress" aria-hidden>
                          <i style={{ width: `${Math.min(100, Math.max(0, d.pctComplete))}%` }} />
                        </div>
                        <p className="dispatch-live-current">
                          {d.jobStatus === "done"
                            ? "Route complete"
                            : d.currentOrderRef
                              ? `Now · ${d.currentOrderRef}`
                              : "Awaiting start"}
                          {d.liveLat != null && d.liveLon != null
                            ? ` · GPS ${d.liveLat.toFixed(4)}, ${d.liveLon.toFixed(4)}`
                            : ""}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {!loading || snapshot ? (
              <DispatchLiveTimeline
                drivers={drivers}
                serviceDate={serviceDate}
                focusJobId={focusJobId}
                focusStopId={focusStopId}
                onSelectJob={selectJob}
                onSelectStop={selectStop}
              />
            ) : null}

            <section className="dispatch-live-manifest panel" aria-label="Manifest">
              <div className="dispatch-pane-head">
                <h2>Manifest</h2>
                <label className="dispatch-live-search">
                  <span className="visually-hidden">Search manifest</span>
                  <input
                    type="search"
                    placeholder="Order, driver, vehicle, lat/lon…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>

              {loading && !snapshot ? (
                <p className="dispatch-live-empty">Loading manifest…</p>
              ) : groupedManifest.length === 0 ? (
                <p className="dispatch-live-empty">No stops match this filter.</p>
              ) : (
                <div className="dispatch-live-table-wrap">
                  <table className="dispatch-live-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Order / stop</th>
                        <th>Status</th>
                        <th>Window</th>
                        <th>Time</th>
                        <th>POD</th>
                        <th>Coords</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupedManifest.map((group) => (
                        <FragmentGroup
                          key={group.driver?.jobId || group.rows[0]?.jobId || "g"}
                          group={group}
                          focusStopId={focusStopId}
                          onFocusJob={selectJob}
                          onFocusStop={selectStop}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function FragmentGroup({
  group,
  focusStopId,
  onFocusJob,
  onFocusStop,
}: {
  group: { driver: DispatchLiveDriver | null; rows: DispatchLiveStop[] };
  focusStopId: string | null;
  onFocusJob: (jobId: string) => void;
  onFocusStop: (jobId: string, stopId: string) => void;
}) {
  const label = group.driver
    ? `${group.driver.driverName} · ${group.driver.vehicleLabel}`
    : group.rows[0]?.driverName || "Driver";
  const jobId = group.driver?.jobId || group.rows[0]?.jobId || null;

  return (
    <>
      <tr className="dispatch-live-group-row">
        <td colSpan={7}>
          <button
            type="button"
            className="dispatch-live-group-btn"
            onClick={() => jobId && onFocusJob(jobId)}
          >
            {label}
            {group.driver ? ` · ${group.driver.pctComplete}%` : ""}
          </button>
        </td>
      </tr>
      {group.rows.map((row) => {
        const tone = statusTone(row.status);
        const selected = focusStopId === row.stopId;
        const coords =
          row.lat != null && row.lon != null
            ? `${row.lat.toFixed(5)}, ${row.lon.toFixed(5)}`
            : row.plannedLat != null && row.plannedLon != null
              ? `plan ${row.plannedLat.toFixed(5)}, ${row.plannedLon.toFixed(5)}`
              : "—";
        const window =
          row.windowStart || row.windowEnd
            ? `${row.windowStart || "—"}–${row.windowEnd || "—"}`
            : "—";
        return (
          <tr
            key={row.stopId}
            data-manifest-stop={row.stopId}
            className={`tone-row-${tone}${selected ? " is-selected" : ""}`}
            onClick={() => onFocusStop(row.jobId, row.stopId)}
          >
            <td>{row.stopNumber}</td>
            <td>
              <strong>{row.externalRef || row.name}</strong>
              {row.externalRef && row.name !== row.externalRef ? <span>{row.name}</span> : null}
              {row.address ? <span className="dispatch-live-sub">{row.address}</span> : null}
            </td>
            <td>
              <em className={`dispatch-live-pill tone-${tone}`}>{statusLabel(tone)}</em>
            </td>
            <td>{window}</td>
            <td>{row.timeLabel || "—"}</td>
            <td>
              <em className={`dispatch-live-pod pod-${row.pod}`}>{podLabel(row.pod)}</em>
            </td>
            <td className="dispatch-live-coords">{coords}</td>
          </tr>
        );
      })}
    </>
  );
}
