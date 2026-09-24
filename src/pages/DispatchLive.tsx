import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { DispatchLiveMap } from "../components/DispatchLiveMap";
import { DispatchLiveTimeline } from "../components/DispatchLiveTimeline";
import { FoldPanel } from "../components/FoldPanel";
import { ViewNav } from "../components/ViewNav";
import {
  ackDispatchOpsException,
  fetchArmadaDayTracks,
  fetchDispatchLive,
  fetchDispatchSla,
  formatServiceDateLabel,
  replanDispatchRemaining,
  shiftServiceDate,
  todayServiceDate,
  type DispatchLiveDriver,
  type DispatchLiveSnapshot,
  type DispatchLiveStop,
  type DispatchLiveStopStatus,
  type DispatchOpsException,
  type DispatchReplanSuggestion,
  type DispatchSlaScorecard,
} from "../lib/dispatch";
import { clipTimedTrackToWindow, type TimedMapPoint } from "../lib/dispatchTrackClip";
import { writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";

const POLL_MS = 20_000;
const FOLD_STORAGE_KEY = "fmplus.dispatchLive.folded";

type TabId = "live" | "history";
type FoldId =
  | "sla"
  | "exceptions"
  | "drivers"
  | "map"
  | "progress"
  | "manifest"
  | "historySla"
  | "historyMap";

type FoldState = Partial<Record<FoldId, boolean>>;

function loadFoldState(): FoldState {
  try {
    const raw = localStorage.getItem(FOLD_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as FoldState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

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

/** Compact age for a live fix: "12s", "4m", "1h 20m". */
function formatFixAge(ageSec: number | null | undefined): string {
  if (ageSec == null || !Number.isFinite(ageSec)) return "";
  const sec = Math.max(0, Math.round(ageSec));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/**
 * Where this driver's dot is coming from. Dispatchers act differently on a
 * 12-second-old phone fix than on a vehicle tracker with no timestamp, so the
 * source and its age are stated rather than shown as a bare lat/lon.
 */
function livePositionLabel(driver: DispatchLiveDriver): {
  text: string;
  stale: boolean;
} | null {
  const pos = driver.livePosition;
  if (!pos) {
    if (driver.liveLat == null || driver.liveLon == null) return null;
    return { text: "Position reported", stale: false };
  }
  const parts: string[] = [];
  if (pos.source === "phone") {
    const age = formatFixAge(pos.ageSec);
    parts.push(age ? `Driver phone · ${age} ago` : "Driver phone");
  } else {
    parts.push("Vehicle GPS");
  }
  if (pos.phoneSeparationKm != null && pos.phoneSeparationKm >= 0.2) {
    parts.push(`${pos.phoneSeparationKm.toFixed(1)} km from vehicle`);
  }
  const stale = pos.source === "phone" && pos.ageSec != null && pos.ageSec > 300;
  return { text: parts.join(" · "), stale };
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
    row.phoneLat != null && row.phoneLon != null ? `${row.phoneLat},${row.phoneLon}` : "",
    row.vehicleLat != null && row.vehicleLon != null ? `${row.vehicleLat},${row.vehicleLon}` : "",
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

function exceptionKindLabel(kind: string): string {
  if (kind === "window_at_risk") return "At risk";
  if (kind === "stuck") return "Stuck";
  if (kind === "failed_skip") return "Skipped";
  return kind;
}

function suggestionTypeLabel(type: string): string {
  if (type === "reorder_same_vehicle") return "Reorder remaining";
  if (type === "return_stop") return "Return to pool";
  if (type === "move_stop") return "Move to other job";
  return type;
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
  const [historySla, setHistorySla] = useState<DispatchSlaScorecard | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverError, setRecoverError] = useState("");
  const [recoverPreview, setRecoverPreview] = useState<DispatchReplanSuggestion[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<string[]>([]);
  const [actionNote, setActionNote] = useState("");
  /** Armada day polylines keyed by `${userId}|${date}` — loaded separately from the 20s live poll. */
  const [armadaTracks, setArmadaTracks] = useState<Map<string, TimedMapPoint[]>>(new Map());
  const [armadaTracksLoading, setArmadaTracksLoading] = useState(false);
  const [folded, setFolded] = useState<FoldState>(() => loadFoldState());

  function toggleFold(id: FoldId) {
    setFolded((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  useEffect(() => {
    document.title = "Dispatch Live · ARMADA M.1";
  }, []);

  useEffect(() => {
    writeLocationSearch({ date: serviceDate || null });
  }, [serviceDate]);

  useEffect(() => {
    if (!ready || (tab !== "live" && tab !== "history")) return;
    const ac = new AbortController();
    let cancelled = false;
    if (tab === "live") setLoading(true);
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
        if (!cancelled && tab === "live") setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [ready, serviceDate, tab, tick]);

  // Armada vehicle day tracks: once per date / vehicle set (not every live poll).
  const armadaTrackJobsKey = useMemo(() => {
    if (!snapshot?.drivers?.length) return "";
    return snapshot.drivers
      .filter((d) => d.armadaUserId != null)
      .map((d) => `${d.armadaUserId}`)
      .sort()
      .join(",");
  }, [snapshot?.drivers]);

  useEffect(() => {
    if (!ready || (tab !== "live" && tab !== "history") || !armadaTrackJobsKey) return;
    const days = armadaTrackJobsKey
      .split(",")
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .map((userId) => ({ userId, date: serviceDate }));
    if (!days.length) return;
    let cancelled = false;
    const load = (refresh = false) => {
      const ac = new AbortController();
      if (!refresh) setArmadaTracksLoading(true);
      fetchArmadaDayTracks(days, ac.signal, refresh ? { refresh: true } : undefined)
        .then((map) => {
          if (!cancelled) setArmadaTracks(map);
        })
        .catch(() => {
          /* keep prior tracks if a refetch fails */
        })
        .finally(() => {
          if (!cancelled) setArmadaTracksLoading(false);
        });
      return ac;
    };
    const first = load(false);
    const pollToday = serviceDate === todayServiceDate();
    const timer = pollToday
      ? window.setInterval(() => {
          load(true);
        }, 120_000)
      : 0;
    return () => {
      cancelled = true;
      first.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [ready, tab, serviceDate, armadaTrackJobsKey]);

  useEffect(() => {
    setArmadaTracks(new Map());
    setArmadaTracksLoading(false);
  }, [serviceDate]);

  useEffect(() => {
    if (!ready || tab !== "live") return;
    const id = window.setInterval(() => setTick((n) => n + 1), POLL_MS);
    return () => window.clearInterval(id);
  }, [ready, tab, serviceDate]);

  useEffect(() => {
    if (!ready || tab !== "history") return;
    const ac = new AbortController();
    let cancelled = false;
    setHistoryLoading(true);
    fetchDispatchSla(serviceDate, ac.signal)
      .then((data) => {
        if (cancelled) return;
        setHistorySla(data.sla);
        setHistoryError("");
      })
      .catch((err: Error) => {
        if (cancelled || err.name === "AbortError") return;
        setHistoryError(err.message || "Failed to load SLA");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [ready, tab, serviceDate, tick]);

  useEffect(() => {
    if (!focusStopId) return;
    const el = document.querySelector(`[data-manifest-stop="${CSS.escape(focusStopId)}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusStopId, snapshot?.manifest]);

  const summary = snapshot?.summary;
  const drivers = useMemo(() => {
    const list = snapshot?.drivers || [];
    const now = Date.now();
    return list.map((d) => {
      if (d.armadaUserId == null) return d;
      const key = `${d.armadaUserId}|${serviceDate}`;
      const timed = armadaTracks.get(key) || [];
      let track = timed.length
        ? clipTimedTrackToWindow(timed, d.startedAt, d.completedAt, now)
        : [];
      const live = d.vehiclePos;
      if (
        live &&
        Number.isFinite(live.lat) &&
        Number.isFinite(live.lon) &&
        Math.abs(live.lat) <= 90 &&
        Math.abs(live.lon) <= 180
      ) {
        const last = track[track.length - 1];
        if (!last || last[0] !== live.lat || last[1] !== live.lon) {
          track = [...track, [live.lat, live.lon]];
        }
      }
      if (track.length < 2) {
        const crumbs: [number, number][] = [];
        for (const s of d.stops || []) {
          for (const pair of [
            [s.startVehicleLat, s.startVehicleLon],
            [s.vehicleLat, s.vehicleLon],
          ] as const) {
            const lat = Number(pair[0]);
            const lon = Number(pair[1]);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
            crumbs.push([lat, lon]);
          }
        }
        if (crumbs.length >= 2) track = crumbs;
      }
      if (track.length < 2) return d;
      return { ...d, armadaTrack: track };
    });
  }, [snapshot?.drivers, armadaTracks, serviceDate]);
  const mapFitKey = `${serviceDate}:${focusJobId || "all"}:${drivers.length}:${armadaTracks.size}`;
  const exceptions = snapshot?.exceptions || [];
  const exceptionSummary = snapshot?.exceptionSummary;
  const sla = snapshot?.sla;

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

  async function runRecoverPreview() {
    setRecoverBusy(true);
    setRecoverError("");
    setActionNote("");
    try {
      const res = await replanDispatchRemaining({
        serviceDate,
        jobIds: focusJobId ? [focusJobId] : undefined,
        apply: false,
      });
      setRecoverPreview(res.preview.suggestions);
      setSelectedSuggestions(res.preview.suggestions.filter((s) => s.safeAuto).map((s) => s.id));
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : "Recover preview failed");
      setRecoverPreview(null);
    } finally {
      setRecoverBusy(false);
    }
  }

  async function applyRecover(opts: { autoSafe?: boolean; ids?: string[] }) {
    setRecoverBusy(true);
    setRecoverError("");
    try {
      const res = await replanDispatchRemaining({
        serviceDate,
        jobIds: focusJobId ? [focusJobId] : undefined,
        apply: true,
        autoSafe: opts.autoSafe === true,
        suggestionIds: opts.ids,
      });
      const n = res.result?.appliedCount ?? 0;
      setActionNote(
        opts.autoSafe
          ? `Safe auto applied ${n} same-vehicle reorder(s).`
          : `Applied ${n} recovery action(s).`,
      );
      setRecoverPreview(null);
      setSelectedSuggestions([]);
      setTick((t) => t + 1);
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : "Apply recover failed");
    } finally {
      setRecoverBusy(false);
    }
  }

  async function ackException(ex: DispatchOpsException) {
    try {
      await ackDispatchOpsException(ex.id);
      setTick((t) => t + 1);
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : "Ack failed");
    }
  }

  return (
    <div className="app dispatch-page dispatch-live-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Dispatch Live</h1>
            <p>Monitor · exceptions · recover · SLA</p>
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

          {tab === "live" ? (
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
              <button
                type="button"
                className="btn-secondary"
                disabled={recoverBusy}
                onClick={() => void runRecoverPreview()}
              >
                Recover…
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={recoverBusy}
                title="Auto-apply only same-vehicle remaining reorders"
                onClick={() => void applyRecover({ autoSafe: true })}
              >
                Safe auto
              </button>
            </div>
          ) : null}
        </section>

        {bootError ? <div className="dispatch-alert">{bootError}</div> : null}

        {tab === "history" ? (
          <>
            <FoldPanel
              id="historySla"
              title="Day scorecard"
              folded={Boolean(folded.historySla)}
              onToggle={() => toggleFold("historySla")}
              hint={
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={historyLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTick((n) => n + 1);
                  }}
                >
                  Refresh
                </button>
              }
            >
              {historyError ? <div className="dispatch-alert">{historyError}</div> : null}
              {historyLoading && !historySla ? (
                <p className="dispatch-live-empty">Loading scorecard…</p>
              ) : historySla ? (
                <SlaPanel sla={historySla} detailed bare />
              ) : (
                <p className="dispatch-live-empty">No scorecard for this date.</p>
              )}
            </FoldPanel>
            <FoldPanel
              id="historyMap"
              className="dispatch-live-map-panel"
              title="Map"
              folded={Boolean(folded.historyMap)}
              onToggle={() => toggleFold("historyMap")}
              hint={
                armadaTracksLoading
                  ? "Loading vehicle tracks…"
                  : "Plan · phone · Armada (clipped to each job)"
              }
            >
              {fetchError ? <div className="dispatch-alert">{fetchError}</div> : null}
              {drivers.length === 0 ? (
                <p className="dispatch-live-empty">No routes to plot for this date.</p>
              ) : (
                <DispatchLiveMap
                  drivers={drivers}
                  focusJobId={focusJobId}
                  fitKey={`hist:${mapFitKey}`}
                  onSelectJob={selectJob}
                />
              )}
            </FoldPanel>
          </>
        ) : (
          <>
            {fetchError ? <div className="dispatch-alert">{fetchError}</div> : null}
            {recoverError ? <div className="dispatch-alert">{recoverError}</div> : null}
            {actionNote ? <p className="dispatch-search-hint">{actionNote}</p> : null}

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
                  {summary?.skipped
                    ? `${summary.skipped} skipped`
                    : `${summary?.driverCount ?? 0} drivers`}
                </em>
              </article>
              <article
                className={`dispatch-live-kpi${(exceptionSummary?.total || 0) > 0 ? " tone-warn" : ""}`}
              >
                <span>Exceptions</span>
                <strong>{exceptionSummary?.total ?? 0}</strong>
                <em>
                  {exceptionSummary
                    ? `${exceptionSummary.windowAtRisk} risk · ${exceptionSummary.stuck} stuck · ${exceptionSummary.failedSkip} skip`
                    : ""}
                </em>
              </article>
              <article className="dispatch-live-kpi tone-ok">
                <span>OTP</span>
                <strong>{sla?.otpPct != null ? `${sla.otpPct}%` : "—"}</strong>
                <em>
                  {sla?.medianPlanLagMin != null
                    ? `plan lag ${sla.medianPlanLagMin >= 0 ? "+" : ""}${sla.medianPlanLagMin}m`
                    : "on-window"}
                </em>
              </article>
            </section>

            {sla ? (
              <FoldPanel
                id="sla"
                title="SLA today"
                folded={Boolean(folded.sla)}
                onToggle={() => toggleFold("sla")}
              >
                <SlaPanel sla={sla} bare />
              </FoldPanel>
            ) : null}

            <FoldPanel
              id="exceptions"
              title="Exceptions"
              folded={Boolean(folded.exceptions)}
              onToggle={() => toggleFold("exceptions")}
              hint={
                exceptionSummary?.unacked ? (
                  <em className="dispatch-live-pill tone-delayed">{exceptionSummary.unacked} open</em>
                ) : null
              }
            >
              {exceptions.length === 0 ? (
                <p className="dispatch-live-empty">No open exceptions for this date.</p>
              ) : (
                <ul className="dispatch-live-exception-list">
                  {exceptions.map((ex) => (
                    <li key={ex.id} className={`sev-${ex.severity}`}>
                      <div>
                        <strong>
                          <em className="dispatch-live-pill tone-delayed">
                            {exceptionKindLabel(ex.kind)}
                          </em>{" "}
                          {ex.title}
                        </strong>
                        <span>{ex.detail}</span>
                      </div>
                      <div className="dispatch-live-exception-actions">
                        {ex.jobId ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                              selectJob(ex.jobId!);
                              if (ex.stopId) selectStop(ex.jobId!, ex.stopId);
                            }}
                          >
                            Focus
                          </button>
                        ) : null}
                        {!ex.ackedAt ? (
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => void ackException(ex)}
                          >
                            Ack
                          </button>
                        ) : (
                          <span className="dispatch-live-sub">Acked</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </FoldPanel>

            {recoverPreview ? (
              <section className="dispatch-live-recover panel" aria-label="Recovery preview">
                <div className="dispatch-pane-head">
                  <h2>Recovery suggestions</h2>
                  <div className="dispatch-plan-job-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setRecoverPreview(null);
                        setSelectedSuggestions([]);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={recoverBusy || selectedSuggestions.length === 0}
                      onClick={() => void applyRecover({ ids: selectedSuggestions })}
                    >
                      Apply selected
                    </button>
                  </div>
                </div>
                {recoverPreview.length === 0 ? (
                  <p className="dispatch-live-empty">No recovery actions suggested.</p>
                ) : (
                  <ul className="dispatch-live-exception-list">
                    {recoverPreview.map((s) => {
                      const checked = selectedSuggestions.includes(s.id);
                      return (
                        <li key={s.id}>
                          <label className="dispatch-plan-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedSuggestions((prev) =>
                                  prev.includes(s.id)
                                    ? prev.filter((id) => id !== s.id)
                                    : [...prev, s.id],
                                );
                              }}
                            />
                            <span>
                              <strong>
                                {suggestionTypeLabel(s.type)}
                                {s.safeAuto ? " · safe" : ""}
                              </strong>
                              <em>
                                {s.reason}
                                {s.jobLabel ? ` · ${s.jobLabel}` : ""}
                                {s.toJobLabel ? ` → ${s.toJobLabel}` : ""}
                              </em>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : null}

            <FoldPanel
              id="drivers"
              className="dispatch-live-drivers"
              title="Drivers"
              folded={Boolean(folded.drivers)}
              onToggle={() => toggleFold("drivers")}
              hint={
                focusJobId ? (
                  <button type="button" className="btn-ghost" onClick={clearFocus}>
                    Clear focus
                  </button>
                ) : null
              }
            >
              {!loading && drivers.length === 0 ? (
                <p className="dispatch-live-empty">No assigned jobs for this date.</p>
              ) : (
                <div className="dispatch-live-driver-row">
                  {drivers.map((d) => {
                    const tone = statusTone(String(d.currentStatus));
                    const focused = focusJobId === d.jobId;
                    const rem = d.remainingWork?.remainingCount;
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
                          <span className="dispatch-live-driver-tags">
                            {(d.dayCount || 1) > 1 ? (
                              <em className="dispatch-live-day-badge">
                                Day {d.dayNumber || 1}/{d.dayCount}
                              </em>
                            ) : null}
                            <em className={`dispatch-live-pill tone-${tone}`}>
                              {statusLabel(tone)}
                            </em>
                          </span>
                        </div>
                        <div className="dispatch-live-driver-meta">
                          <span>
                            {d.doneCount}/{d.stopCount} stops · {d.pctComplete}%
                            {rem != null ? ` · ${rem} left` : ""}
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
                        </p>
                        {d.carryoverStopIds?.length ? (
                          <p className="dispatch-live-source is-stale">
                            {d.carryoverStopIds.length} stop
                            {d.carryoverStopIds.length === 1 ? "" : "s"} still open from an earlier
                            day
                          </p>
                        ) : null}
                        {(() => {
                          const src = livePositionLabel(d);
                          if (!src) {
                            return d.jobStatus === "done" ? null : (
                              <p className="dispatch-live-source is-missing">No position</p>
                            );
                          }
                          return (
                            <p
                              className={`dispatch-live-source${src.stale ? " is-stale" : ""}`}
                            >
                              {src.text}
                            </p>
                          );
                        })()}
                      </button>
                    );
                  })}
                </div>
              )}
            </FoldPanel>

            {!loading || snapshot ? (
              <FoldPanel
                id="map"
                className="dispatch-live-map-panel"
                title="Map"
                folded={Boolean(folded.map)}
                onToggle={() => toggleFold("map")}
                hint={
                  armadaTracksLoading
                    ? "Loading vehicle tracks…"
                    : focusJobId
                      ? "Focused job"
                      : "Plan · phone · Armada"
                }
              >
                {drivers.length === 0 ? (
                  <p className="dispatch-live-empty">No routes to plot for this date.</p>
                ) : (
                  <DispatchLiveMap
                    drivers={drivers}
                    focusJobId={focusJobId}
                    fitKey={mapFitKey}
                    onSelectJob={selectJob}
                  />
                )}
              </FoldPanel>
            ) : null}

            {!loading || snapshot ? (
              <FoldPanel
                id="progress"
                className="dispatch-live-timeline"
                title="Progress"
                folded={Boolean(folded.progress)}
                onToggle={() => toggleFold("progress")}
                hint="faded plan · green actual"
              >
                <DispatchLiveTimeline
                  drivers={drivers}
                  serviceDate={serviceDate}
                  focusJobId={focusJobId}
                  focusStopId={focusStopId}
                  onSelectJob={selectJob}
                  onSelectStop={selectStop}
                  embedded
                />
              </FoldPanel>
            ) : null}

            <FoldPanel
              id="manifest"
              className="dispatch-live-manifest"
              title="Manifest"
              folded={Boolean(folded.manifest)}
              onToggle={() => toggleFold("manifest")}
              hint={
                <label className="dispatch-live-search">
                  <span className="visually-hidden">Search manifest</span>
                  <input
                    type="search"
                    placeholder="Order, driver, vehicle, lat/lon…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </label>
              }
            >
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
                        <th>Start</th>
                        <th>End</th>
                        <th>POD</th>
                        <th>Plan</th>
                        <th>Phone</th>
                        <th>Vehicle</th>
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
            </FoldPanel>
          </>
        )}
      </main>
    </div>
  );
}

function SlaPanel({
  sla,
  detailed = false,
  bare = false,
}: {
  sla: DispatchSlaScorecard;
  detailed?: boolean;
  bare?: boolean;
}) {
  const body = (
    <div className="dispatch-live-kpis dispatch-live-sla-kpis">
      <article className="dispatch-live-kpi tone-ok">
        <span>OTP</span>
        <strong>{sla.otpPct != null ? `${sla.otpPct}%` : "—"}</strong>
        <em>{sla.withWindow ? `${sla.onTime}/${sla.withWindow} on window` : "no window stops"}</em>
      </article>
      <article className={`dispatch-live-kpi${sla.late > 0 ? " tone-warn" : ""}`}>
        <span>Late</span>
        <strong>{sla.late}</strong>
      </article>
      <article className={`dispatch-live-kpi${sla.atRiskCount > 0 ? " tone-warn" : ""}`}>
        <span>At risk</span>
        <strong>{sla.atRiskCount}</strong>
      </article>
      <article className="dispatch-live-kpi">
        <span>Skipped</span>
        <strong>{sla.skipped}</strong>
        <em>{sla.stuckCount ? `${sla.stuckCount} stuck` : ""}</em>
      </article>
      <article className="dispatch-live-kpi">
        <span>Plan lag</span>
        <strong>
          {sla.medianPlanLagMin != null
            ? `${sla.medianPlanLagMin >= 0 ? "+" : ""}${sla.medianPlanLagMin}m`
            : "—"}
        </strong>
        <em>median</em>
      </article>
    </div>
  );
  if (bare) {
    return (
      <>
        {body}
        {detailed && sla.byDriver.length > 0 ? (
          <div className="dispatch-live-table-wrap">
            <table className="dispatch-live-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Delivered</th>
                  <th>On time</th>
                  <th>Late</th>
                  <th>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {sla.byDriver.map((d) => (
                  <tr key={d.jobId}>
                    <td>
                      <strong>{d.driverName}</strong>
                      {d.vehicleLabel ? <span className="dispatch-live-sub">{d.vehicleLabel}</span> : null}
                    </td>
                    <td>{d.delivered}</td>
                    <td>{d.onTime}</td>
                    <td>{d.late}</td>
                    <td>{d.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </>
    );
  }
  return (
    <section className="dispatch-live-sla panel" aria-label="SLA scorecard">
      <div className="dispatch-pane-head">
        <h2>{detailed ? `SLA · ${sla.serviceDate}` : "SLA today"}</h2>
      </div>
      {body}
      {detailed && sla.byDriver.length > 0 ? (
        <div className="dispatch-live-table-wrap">
          <table className="dispatch-live-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Delivered</th>
                <th>On time</th>
                <th>Late</th>
                <th>Skipped</th>
              </tr>
            </thead>
            <tbody>
              {sla.byDriver.map((d) => (
                <tr key={d.jobId}>
                  <td>
                    <strong>{d.driverName}</strong>
                    {d.vehicleLabel ? <span className="dispatch-live-sub">{d.vehicleLabel}</span> : null}
                  </td>
                  <td>{d.delivered}</td>
                  <td>{d.onTime}</td>
                  <td>{d.late}</td>
                  <td>{d.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function formatCoordPair(lat: number | null | undefined, lon: number | null | undefined): string {
  if (lat == null || lon == null) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function formatStraightDist(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m from plan`;
  return `${km.toFixed(2)} km from plan`;
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
        <td colSpan={9}>
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
        const phoneDist = formatStraightDist(row.planToPhoneKm);
        const vehicleDist = formatStraightDist(row.planToVehicleKm);
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
            <td>{row.arrivedLabel || "—"}</td>
            <td>{row.completedLabel || "—"}</td>
            <td>
              <em className={`dispatch-live-pod pod-${row.pod}`}>{podLabel(row.pod)}</em>
            </td>
            <td className="dispatch-live-coords">{formatCoordPair(row.plannedLat, row.plannedLon)}</td>
            <td className="dispatch-live-coords">
              {formatCoordPair(row.phoneLat, row.phoneLon)}
              {phoneDist ? <span className="dispatch-live-sub">{phoneDist}</span> : null}
            </td>
            <td className="dispatch-live-coords">
              {formatCoordPair(row.vehicleLat, row.vehicleLon)}
              {vehicleDist ? <span className="dispatch-live-sub">{vehicleDist}</span> : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}
