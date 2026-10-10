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
  fetchPhoneTrailForDate,
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
import { livePositionLabel } from "../lib/dispatchLiveLabel";
import { clipTimedTrackToWindow, type TimedMapPoint } from "../lib/dispatchTrackClip";
import { phoneTrailOrCrumbs } from "../lib/dispatchPhoneTrail";
import { writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";

const POLL_MS = 20_000;
const FOLD_STORAGE_KEY = "fmplus.dispatchLive.folded";

type TabId = "live" | "history";
/** Phone Live: one section at a time (desktop still shows the full stack). */
type LiveMobilePane = "summary" | "alerts" | "map" | "progress" | "drivers" | "list";
type FoldId =
  | "sla"
  | "exceptions"
  | "drivers"
  | "map"
  | "progress"
  | "manifest"
  | "historySla"
  | "historyMap";

const LIVE_MOBILE_PANES: { id: LiveMobilePane; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "alerts", label: "Alerts" },
  { id: "map", label: "Map" },
  { id: "progress", label: "Progress" },
  { id: "drivers", label: "Drivers" },
  { id: "list", label: "List" },
];

type FoldState = Partial<Record<FoldId, boolean>>;

function defaultPhoneFoldState(): FoldState {
  if (typeof window === "undefined") return {};
  try {
    if (!window.matchMedia("(max-width: 700px)").matches) return {};
  } catch {
    return {};
  }
  return {
    sla: true,
    drivers: true,
    progress: true,
    manifest: true,
    historySla: true,
    exceptions: false,
    map: false,
    historyMap: false,
  };
}

function loadFoldState(): FoldState {
  try {
    const raw = localStorage.getItem(FOLD_STORAGE_KEY);
    if (!raw) return defaultPhoneFoldState();
    const parsed = JSON.parse(raw) as FoldState;
    return parsed && typeof parsed === "object" ? parsed : defaultPhoneFoldState();
  } catch {
    return defaultPhoneFoldState();
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
  const [phoneTracks, setPhoneTracks] = useState<Map<string, TimedMapPoint[]>>(new Map());
  const [folded, setFolded] = useState<FoldState>(() => loadFoldState());
  const [livePane, setLivePane] = useState<LiveMobilePane>("summary");

  function openLivePane(pane: LiveMobilePane) {
    setLivePane(pane);
    const unfold: FoldId[] =
      pane === "summary"
        ? ["sla"]
        : pane === "alerts"
          ? ["exceptions"]
          : pane === "map"
            ? ["map"]
            : pane === "progress"
              ? ["progress"]
              : pane === "drivers"
                ? ["drivers"]
                : pane === "list"
                  ? ["manifest"]
                  : [];
    if (!unfold.length) return;
    setFolded((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const id of unfold) {
        if (next[id]) {
          next[id] = false;
          changed = true;
        }
      }
      if (!changed) return prev;
      try {
        localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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
    setPhoneTracks(new Map());
  }, [serviceDate]);

  const phoneTrackJobsKey = useMemo(() => {
    if (!snapshot?.drivers?.length) return "";
    return snapshot.drivers
      .map((d) => d.assignedFieldUserId)
      .filter((id): id is string => Boolean(id))
      .sort()
      .join(",");
  }, [snapshot?.drivers]);

  useEffect(() => {
    if (!ready || (tab !== "live" && tab !== "history") || !phoneTrackJobsKey) return;
    const ids = [...new Set(phoneTrackJobsKey.split(",").filter(Boolean))];
    if (!ids.length) return;
    let cancelled = false;
    const load = () => {
      Promise.all(
        ids.map((id) =>
          fetchPhoneTrailForDate(id, serviceDate).then((points) => [id, points] as const),
        ),
      )
        .then((rows) => {
          if (cancelled) return;
          setPhoneTracks(new Map(rows));
        })
        .catch(() => {
          /* keep prior trails if a refetch fails */
        });
    };
    load();
    const pollToday = serviceDate === todayServiceDate();
    const timer = pollToday ? window.setInterval(load, 60_000) : 0;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [ready, tab, serviceDate, phoneTrackJobsKey]);

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
      const timedPhone = d.assignedFieldUserId
        ? phoneTracks.get(d.assignedFieldUserId) || []
        : [];
      const fromFetch = timedPhone.length
        ? clipTimedTrackToWindow(timedPhone, d.startedAt, d.completedAt, now)
        : [];
      const phoneTrail = phoneTrailOrCrumbs(fromFetch.length >= 2 ? fromFetch : d.phoneTrail, d);

      if (d.armadaUserId == null) {
        return { ...d, phoneTrail };
      }
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
      return { ...d, phoneTrail, armadaTrack: track.length >= 2 ? track : d.armadaTrack };
    });
  }, [snapshot?.drivers, armadaTracks, phoneTracks, serviceDate]);
  const mapFitKey = `${serviceDate}:${focusJobId || "all"}:${drivers.length}:${armadaTracks.size}:${phoneTracks.size}`;
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
    <div
      className={`app dispatch-page dispatch-live-page${
        tab === "live" && livePane === "map" ? " is-live-map-pane" : ""
      }`}
    >
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
                className="btn-secondary dispatch-live-recover-btn"
                disabled={recoverBusy}
                onClick={() => {
                  openLivePane("alerts");
                  void runRecoverPreview();
                }}
              >
                Recover…
              </button>
              <button
                type="button"
                className="btn-ghost dispatch-live-safe-auto-btn"
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
          <div className={`dispatch-live-mobile is-pane-${livePane}`}>
            <nav className="dispatch-live-mobile-nav" role="tablist" aria-label="Live sections">
              {LIVE_MOBILE_PANES.map((pane) => (
                <button
                  key={pane.id}
                  type="button"
                  role="tab"
                  aria-selected={livePane === pane.id}
                  className={`dispatch-live-mobile-tab${livePane === pane.id ? " is-active" : ""}`}
                  onClick={() => openLivePane(pane.id)}
                >
                  {pane.label}
                  {pane.id === "alerts" && (exceptionSummary?.unacked || 0) > 0 ? (
                    <em>{exceptionSummary?.unacked}</em>
                  ) : null}
                </button>
              ))}
            </nav>

            {fetchError ? <div className="dispatch-alert">{fetchError}</div> : null}
            {recoverError ? <div className="dispatch-alert">{recoverError}</div> : null}
            {actionNote ? <p className="dispatch-search-hint">{actionNote}</p> : null}

            <section className="dispatch-live-kpis" data-live-pane="summary" aria-label="Live summary">
              <article className="dispatch-live-kpi">
                <span>Stops</span>
                <strong>{summary?.totalStops ?? "—"}</strong>
                <em>{summary ? `${summary.driverCount} drivers assigned` : ""}</em>
              </article>
              <article className="dispatch-live-kpi">
                <span>In transit</span>
                <strong>{summary?.inTransit ?? "—"}</strong>
                <em>
                  {summary
                    ? summary.inTransit === 0
                      ? "idle fleet"
                      : `${summary.inTransitPct}% of stops`
                    : ""}
                </em>
              </article>
              <article className="dispatch-live-kpi tone-ok is-featured">
                <span>Delivered</span>
                <strong>{summary?.delivered ?? "—"}</strong>
                <em>
                  {summary && summary.totalStops
                    ? `${Math.round((summary.delivered / summary.totalStops) * 100)}% of stops`
                    : ""}
                </em>
              </article>
              <article className="dispatch-live-kpi">
                <span>Pending</span>
                <strong>{summary?.pending ?? "—"}</strong>
                <em>{summary ? "not started" : ""}</em>
              </article>
              <article className={`dispatch-live-kpi${(summary?.delayed || 0) > 0 ? " tone-warn" : ""}`}>
                <span>Delayed</span>
                <strong>{summary?.delayed ?? "—"}</strong>
                <em>{summary ? (summary.delayed > 0 ? "past window" : "on schedule") : ""}</em>
              </article>
              <article className="dispatch-live-kpi">
                <span>Avg complete</span>
                <strong>{summary ? `${summary.avgCompletion}%` : "—"}</strong>
                <em>
                  {summary
                    ? summary.skipped
                      ? `${summary.driverCount} drivers · ${summary.skipped} skipped`
                      : `${summary.driverCount} drivers`
                    : ""}
                </em>
              </article>
            </section>

            <div className="dispatch-live-split" data-live-pane="summary">
            {sla ? (
              <FoldPanel
                id="sla"
                title="SLA today"
                folded={Boolean(folded.sla)}
                onToggle={() => toggleFold("sla")}
                hint={
                  <span>
                    {sla.otpPct != null ? `OTP ${sla.otpPct}%` : "OTP —"}
                    {sla.withWindow ? ` · ${sla.onTime}/${sla.withWindow} on window` : ""}
                    {sla.medianPlanLagMin != null
                      ? ` · ${sla.medianPlanLagMin >= 0 ? "+" : ""}${sla.medianPlanLagMin}m median`
                      : ""}
                  </span>
                }
              >
                <SlaPanel sla={sla} bare />
              </FoldPanel>
            ) : null}
            </div>

            <div data-live-pane="alerts">
            <div className="dispatch-live-mobile-actions">
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
                onClick={() => void applyRecover({ autoSafe: true })}
              >
                Safe auto
              </button>
            </div>
            <FoldPanel
              id="exceptions"
              title="Exceptions"
              folded={Boolean(folded.exceptions)}
              onToggle={() => toggleFold("exceptions")}
              hint={
                <em className={`dispatch-live-pill${(exceptionSummary?.unacked || 0) > 0 ? " tone-delayed" : " tone-delivered"}`}>
                  {exceptionSummary?.unacked ?? 0} open
                </em>
              }
            >
              {!snapshot ? (
                <p className="dispatch-live-empty">{loading ? "Loading exceptions…" : "Exceptions unavailable."}</p>
              ) : exceptions.length === 0 ? (
                <div className="dispatch-live-clear">
                  <span className="dispatch-live-clear-mark" aria-hidden="true">
                    ✓
                  </span>
                  <strong>All clear</strong>
                  <p>No open exceptions for this date.</p>
                  <div className="dispatch-live-clear-chips">
                    <span>{exceptionSummary?.windowAtRisk ?? 0} risk</span>
                    <span>{exceptionSummary?.stuck ?? 0} stuck</span>
                    <span>{exceptionSummary?.failedSkip ?? 0} skip</span>
                  </div>
                </div>
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
                              openLivePane("map");
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
            </div>

            <div data-live-pane="drivers">
            <FoldPanel
              id="drivers"
              className="dispatch-live-drivers"
              title="Drivers"
              folded={Boolean(folded.drivers)}
              onToggle={() => toggleFold("drivers")}
              hint={
                <>
                  <span>
                    {drivers.length} total ·{" "}
                    {
                      drivers.filter(
                        (d) => d.jobStatus === "done" || statusTone(String(d.currentStatus)) === "delivered",
                      ).length
                    }{" "}
                    delivered
                  </span>
                  {focusJobId ? (
                    <button type="button" className="btn-ghost" onClick={clearFocus}>
                      Clear focus
                    </button>
                  ) : null}
                </>
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
                          {d.jobStatus === "done" || tone === "delivered"
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
            </div>

            <div data-live-pane="map">
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
                    fitKey={`${mapFitKey}:${livePane}`}
                    onSelectJob={selectJob}
                  />
                )}
              </FoldPanel>
            ) : null}

            </div>

            <div data-live-pane="progress">
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
            ) : (
              <p className="dispatch-live-empty">Loading progress…</p>
            )}
            </div>

            <div data-live-pane="list">
            <FoldPanel
              id="manifest"
              className="dispatch-live-manifest"
              title="Manifest"
              folded={Boolean(folded.manifest)}
              onToggle={() => toggleFold("manifest")}
              hint={
                <>
                  <span>
                    {filteredManifest.length} stop{filteredManifest.length === 1 ? "" : "s"}
                  </span>
                  <label className="dispatch-live-search">
                    <span className="visually-hidden">Search manifest</span>
                    <input
                      type="search"
                      placeholder="Order, driver, vehicle…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </label>
                </>
              }
            >
              {loading && !snapshot ? (
                <p className="dispatch-live-empty">Loading manifest…</p>
              ) : groupedManifest.length === 0 ? (
                <p className="dispatch-live-empty">No stops match this filter.</p>
              ) : (
                <>
                  <div className="dispatch-live-manifest-cards" aria-label="Stop cards">
                    {groupedManifest.map((group) => (
                      <ManifestCardGroup
                        key={group.driver?.jobId || group.rows[0]?.jobId || "g"}
                        group={group}
                        focusStopId={focusStopId}
                        onFocusJob={selectJob}
                        onFocusStop={(jobId, stopId) => {
                          selectStop(jobId, stopId);
                          openLivePane("map");
                        }}
                      />
                    ))}
                  </div>
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
                </>
              )}
              {!loading || snapshot ? (
                <p className="dispatch-live-manifest-foot">
                  Showing {filteredManifest.length} of {(snapshot?.manifest || []).length} stops
                </p>
              ) : null}
            </FoldPanel>
            </div>
          </div>
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
        <em>{sla.late === 1 ? "1 stop past window" : sla.late > 0 ? `${sla.late} stops past window` : "on window"}</em>
      </article>
      <article className={`dispatch-live-kpi${sla.atRiskCount > 0 ? " tone-warn" : ""}`}>
        <span>At risk</span>
        <strong>{sla.atRiskCount}</strong>
        <em>{sla.atRiskCount > 0 ? "window at risk" : "no risk detected"}</em>
      </article>
      <article className="dispatch-live-kpi">
        <span>Skipped</span>
        <strong>{sla.skipped}</strong>
        <em>{sla.stuckCount ? `${sla.stuckCount} stuck` : sla.skipped > 0 ? "not attempted" : "all attempted"}</em>
      </article>
      <article className="dispatch-live-kpi">
        <span>Plan lag</span>
        <strong>
          {sla.medianPlanLagMin != null
            ? `${sla.medianPlanLagMin >= 0 ? "+" : ""}${sla.medianPlanLagMin}m`
            : "—"}
        </strong>
        <em>median delay</em>
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

function ManifestCardGroup({
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
  const name = group.driver?.driverName || group.rows[0]?.driverName || "Driver";
  const initials = group.driver?.driverInitials || name.slice(0, 2).toUpperCase();
  const vehicle = group.driver?.vehicleLabel || group.rows[0]?.vehicleLabel || "";
  const jobId = group.driver?.jobId || group.rows[0]?.jobId || null;

  return (
    <section className="dispatch-live-card-group">
      <button
        type="button"
        className="dispatch-live-card-driver"
        onClick={() => jobId && onFocusJob(jobId)}
      >
        <span className="dispatch-live-avatar" aria-hidden="true">
          {initials}
        </span>
        <div>
          <strong>{name}</strong>
          <span>
            {vehicle ? `${vehicle} · ` : ""}
            {group.rows.length} stop{group.rows.length === 1 ? "" : "s"}
            {group.driver ? ` · ${group.driver.pctComplete}%` : ""}
          </span>
        </div>
      </button>
      <ul className="dispatch-live-card-list">
        {group.rows.map((row) => {
          const tone = statusTone(row.status);
          const selected = focusStopId === row.stopId;
          return (
            <li key={row.stopId}>
              <button
                type="button"
                className={`dispatch-live-stop-card tone-${tone}${selected ? " is-selected" : ""}`}
                onClick={() => onFocusStop(row.jobId, row.stopId)}
              >
                <div className="dispatch-live-stop-card-top">
                  <em>#{row.stopNumber}</em>
                  <strong>{row.externalRef || row.name}</strong>
                  <span className={`dispatch-live-pill tone-${tone}`}>{statusLabel(tone)}</span>
                </div>
                {row.address || (row.externalRef && row.name !== row.externalRef) ? (
                  <p className="dispatch-live-stop-card-addr">
                    {row.externalRef && row.name !== row.externalRef ? row.name : null}
                    {row.externalRef && row.name !== row.externalRef && row.address ? " · " : null}
                    {row.address || null}
                  </p>
                ) : null}
                <div className="dispatch-live-stop-card-meta">
                  <span>
                    Start <b>{row.arrivedLabel || "—"}</b>
                  </span>
                  <span>
                    End <b>{row.completedLabel || "—"}</b>
                  </span>
                  <span className={`dispatch-live-pod pod-${row.pod}`}>POD {podLabel(row.pod)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
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
  const name = group.driver?.driverName || group.rows[0]?.driverName || "Driver";
  const initials = group.driver?.driverInitials || name.slice(0, 2).toUpperCase();
  const vehicle = group.driver?.vehicleLabel || group.rows[0]?.vehicleLabel || "";
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
            <span className="dispatch-live-avatar" aria-hidden="true">
              {initials}
            </span>
            <strong>{name}</strong>
            <span>
              {vehicle ? `${vehicle} · ` : ""}
              {group.rows.length} stop{group.rows.length === 1 ? "" : "s"}
              {group.driver ? ` · ${group.driver.pctComplete}%` : ""}
            </span>
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
