import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TIMEZONES } from "../lib/config";
import { formatKm, formatSpeed } from "../lib/format";
import { ageLabel, type LastStatusRow } from "../lib/lastStatus";
import {
  classifyLiveRow,
  countLiveByClass,
  LIVE_OPS_CLASSES,
  LIVE_OPS_COLORS,
  LIVE_OPS_LABELS,
  type LiveOpsClass,
} from "../lib/liveOps";
import {
  fullHref,
  liveHref,
  maintenanceHref,
  tripsHref,
  writeLocationSearch,
} from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import { useDeskSession } from "../lib/deskSession";
import { deskCanWrite } from "../lib/deskPrivileges";
import { tenantHeaders } from "../lib/tenant";
import {
  fetchTrackerDeviceGroups,
  fetchTrackerLastStatus,
  trackerFixToStatusRow,
  type TrackerDeviceGroup,
  type TrackerLastFix,
} from "../lib/trackerDevices";
import { BrandMark } from "../components/BrandMark";
import { FleetLiveAlertsPanel } from "../components/FleetLiveAlertsPanel";
import { FleetLiveDashboardPanel } from "../components/FleetLiveDashboardPanel";
import { FleetLiveHistoryPanel } from "../components/FleetLiveHistoryPanel";
import { FleetLiveMediaPanel } from "../components/FleetLiveMediaPanel";
import { FleetLiveRankingPanel } from "../components/FleetLiveRankingPanel";
import { FleetLiveTripsPanel } from "../components/FleetLiveTripsPanel";
import { LiveOpsMap } from "../components/LiveOpsMap";
import { ViewNav } from "../components/ViewNav";

type ListTab = "all" | LiveOpsClass | "alert" | "maintenance";
type FleetSection = "live" | "dashboard" | "ranking" | "trips" | "history" | "media" | "alerts";

const FLEET_SECTIONS: Array<{
  id: FleetSection;
  label: string;
  feature?: string;
  privilege?:
    | "viewFleetLive"
    | "viewFleetDashboard"
    | "viewFleetRanking"
    | "viewFleetTrips"
    | "viewFleetHistory"
    | "viewFleetMedia"
    | "ackFleetAlerts";
}> = [
  { id: "live", label: "Live", privilege: "viewFleetLive" },
  { id: "dashboard", label: "Dashboard", feature: "fleetLiveDashboard", privilege: "viewFleetDashboard" },
  { id: "ranking", label: "Ranking", feature: "fleetLiveRanking", privilege: "viewFleetRanking" },
  { id: "trips", label: "Trips", feature: "fleetLiveTrips", privilege: "viewFleetTrips" },
  { id: "history", label: "History", feature: "fleetLiveHistory", privilege: "viewFleetHistory" },
  { id: "media", label: "Media", feature: "fleetLiveMedia", privilege: "viewFleetMedia" },
  { id: "alerts", label: "Alerts", feature: "fleetLiveAlerts", privilege: "ackFleetAlerts" },
];

type SafetyEvent = {
  id: string;
  deviceId: string;
  deviceLabel?: string;
  imei?: string;
  alarmType: string;
  alarmLevel: number;
  recordedAt: string;
  sourceProtocol?: string;
};

type FixMeta = {
  deviceId: string;
  imei: string;
  odometerKm: number | null;
  fuelLevel: number | null;
  fuelLiters: number | null;
  groups: string;
  protocol: string;
};

const LIST_TABS: { id: ListTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "moving", label: "Moving" },
  { id: "idle", label: "Idle" },
  { id: "off", label: "Off" },
  { id: "stale", label: "Stale" },
  { id: "alert", label: "Alert" },
  { id: "maintenance", label: "Maint" },
];

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return q ? `?${q}` : "";
}

function maintenanceOpenHref(userId: number): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.set("open", "1");
  params.delete("userIds");
  const q = params.toString();
  return maintenanceHref(q ? `?${q}` : "?open=1");
}

async function fetchSafetyEvents(signal?: AbortSignal): Promise<SafetyEvent[]> {
  const res = await fetch("/api/tracker/safety-events?limit=40", {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { events?: SafetyEvent[]; error?: string };
  if (!res.ok) throw new Error(data.error || `Safety ${res.status}`);
  return data.events || [];
}

async function fetchOpenMaintenanceUserIds(signal?: AbortSignal): Promise<Set<number>> {
  const params = new URLSearchParams({ status: "open", limit: "200" });
  const res = await fetch(`/api/maintenance/events?${params}`, {
    credentials: "include",
    headers: { accept: "application/json", ...tenantHeaders() },
    signal,
  });
  if (!res.ok) return new Set();
  const data = (await res.json().catch(() => ({}))) as {
    events?: Array<{ armadaUserId?: number | null }>;
  };
  const set = new Set<number>();
  for (const e of data.events || []) {
    const id = Number(e.armadaUserId);
    if (Number.isInteger(id) && id > 0) set.add(id);
  }
  return set;
}

function alarmLabel(type: string): string {
  return String(type || "alert")
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function clockLabel(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone:
        tz === "+07:00"
          ? "Asia/Jakarta"
          : tz === "+08:00"
            ? "Asia/Makassar"
            : tz === "+09:00"
              ? "Asia/Jayapura"
              : "UTC",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toLocaleString();
  }
}

/**
 * Device-native command center (sample-guided). Separate from Armada `/live`.
 */
export default function FleetLive() {
  const { query, ready, error: tenantError, entitlements, moduleAllowed } = useEmbedTenant();
  const { user: deskUser, privileges: deskPrivileges } = useDeskSession();
  const [deviceGroups, setDeviceGroups] = useState<TrackerDeviceGroup[]>([]);
  const [groupId, setGroupId] = useState(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return params.get("deviceGroupId") || "";
  });
  const [section, setSection] = useState<FleetSection>(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const s = params.get("section") || "live";
    return (FLEET_SECTIONS.some((x) => x.id === s) ? s : "live") as FleetSection;
  });
  const [timezone, setTimezone] = useState(query.tz);
  const [bootError, setBootError] = useState("");
  const [rows, setRows] = useState<LastStatusRow[]>([]);
  const [fixMeta, setFixMeta] = useState<Record<number, FixMeta>>({});
  const [alerts, setAlerts] = useState<SafetyEvent[]>([]);
  const [maintUserIds, setMaintUserIds] = useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [listTab, setListTab] = useState<ListTab>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queryText, setQueryText] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(true);
  const [sideNavOpen, setSideNavOpen] = useState(() => {
    try {
      const v = localStorage.getItem("fmplus.fleetLive.sideNav");
      if (v === "0") return false;
      if (v === "1") return true;
    } catch {
      /* ignore */
    }
    return true;
  });

  const selectedGroup = deviceGroups.find((g) => g.id === groupId);

  const allowedSections = useMemo(() => {
    return FLEET_SECTIONS.filter((s) => {
      if (s.feature && entitlements.features[s.feature] === false) return false;
      if (s.privilege && deskUser?.id && !deskCanWrite(deskUser, deskPrivileges, s.privilege)) {
        return false;
      }
      return true;
    });
  }, [entitlements.features, deskUser, deskPrivileges]);

  useEffect(() => {
    if (!allowedSections.some((s) => s.id === section) && allowedSections[0]) {
      setSection(allowedSections[0].id);
    }
  }, [allowedSections, section]);

  useEffect(() => {
    writeLocationSearch({
      deviceGroupId: groupId || null,
      tz: timezone || null,
      section: section || null,
    });
  }, [groupId, timezone, section]);

  useEffect(() => {
    try {
      localStorage.setItem("fmplus.fleetLive.sideNav", sideNavOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sideNavOpen]);

  const fleetModuleOk = moduleAllowed("fleetLive");
  const canViewLive =
    !deskUser?.id || deskCanWrite(deskUser, deskPrivileges, "viewFleetLive");
  const sectionLabel = FLEET_SECTIONS.find((s) => s.id === section)?.label || section;

  useEffect(() => {
    document.title = "Fleet Live · ARMADA M.1";
  }, []);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchTrackerDeviceGroups(ac.signal)
      .then((list) => {
        setDeviceGroups(list);
        setBootError("");
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setDeviceGroups([]);
      });
    return () => ac.abort();
  }, [ready, reload]);

  const statusAbortRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(
    (opts?: { soft?: boolean }) => {
      // Cancel in-flight poll so rapid group switches don't race / blank the map mid-update.
      statusAbortRef.current?.abort();
      const ac = new AbortController();
      statusAbortRef.current = ac;
      const soft = opts?.soft === true;
      if (!soft) setLoading(true);
      setFetchError("");
      return Promise.all([
        fetchTrackerLastStatus(ac.signal, { groupIds: groupId ? [groupId] : undefined }),
        fetchSafetyEvents(ac.signal).catch(() => [] as SafetyEvent[]),
        fetchOpenMaintenanceUserIds(ac.signal).catch(() => new Set<number>()),
      ])
        .then(([deviceStatus, safety, maintIds]) => {
          if (ac.signal.aborted) return;
          const nextRows: LastStatusRow[] = [];
          const meta: Record<number, FixMeta> = {};
          for (const fix of deviceStatus.fixes as TrackerLastFix[]) {
            const row = trackerFixToStatusRow(fix);
            nextRows.push(row);
            meta[row.id] = {
              deviceId: fix.deviceId,
              imei: fix.imei,
              odometerKm: fix.odometerKm ?? null,
              fuelLevel: fix.fuelLevel ?? null,
              fuelLiters: fix.fuelLiters ?? null,
              groups: (fix.groups || []).map((g) => g.name).join(", "),
              protocol: fix.protocol || fix.sourceProtocol || "",
            };
          }
          setRows(nextRows);
          setFixMeta(meta);
          setAlerts(safety);
          setMaintUserIds(maintIds);
          setNow(Date.now());
          setSelectedId((prev) => (prev != null && meta[prev] ? prev : null));
          if (deviceStatus.telematicsSource === "armada") {
            setFetchError("Tenant telematics_source is Armada-only — enable devices or both.");
          }
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setFetchError(err.message || "Fleet live unavailable");
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    },
    [groupId],
  );

  useEffect(() => {
    if (!ready) return;
    void loadStatus();
    return () => statusAbortRef.current?.abort();
  }, [ready, groupId, reload, loadStatus]);

  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => void loadStatus({ soft: true }), 30_000);
    return () => window.clearInterval(id);
  }, [ready, loadStatus]);

  const alertDeviceIds = useMemo(() => {
    const recent = Date.now() - 24 * 60 * 60 * 1000;
    const set = new Set<string>();
    for (const a of alerts) {
      const t = Date.parse(a.recordedAt);
      if (Number.isFinite(t) && t >= recent) set.add(a.deviceId);
    }
    return set;
  }, [alerts]);

  const alertCounts24h = useMemo(() => {
    const recent = Date.now() - 24 * 60 * 60 * 1000;
    const map: Record<string, number> = {};
    for (const a of alerts) {
      const t = Date.parse(a.recordedAt);
      if (!Number.isFinite(t) || t < recent) continue;
      map[a.deviceId] = (map[a.deviceId] || 0) + 1;
    }
    return map;
  }, [alerts]);

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

  const tabCounts = useMemo(() => {
    let alert = 0;
    let maintenance = 0;
    for (const row of rows) {
      const meta = fixMeta[row.id];
      if (meta && alertDeviceIds.has(meta.deviceId)) alert += 1;
      if (row.id > 0 && maintUserIds.has(row.id)) maintenance += 1;
    }
    return { ...counts, alert, maintenance, all: rows.length };
  }, [rows, counts, fixMeta, alertDeviceIds, maintUserIds]);

  const matchesQuery = useCallback(
    (row: LastStatusRow) => {
      const q = queryText.trim().toLowerCase();
      if (!q) return true;
      const meta = fixMeta[row.id];
      return (
        row.name.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        String(row.id).includes(q) ||
        (meta?.imei && meta.imei.toLowerCase().includes(q)) ||
        (meta?.groups && meta.groups.toLowerCase().includes(q))
      );
    },
    [queryText, fixMeta],
  );

  const searchFiltered = useMemo(() => rows.filter(matchesQuery), [rows, matchesQuery]);

  const filtered = useMemo(() => {
    return searchFiltered.filter((row) => {
      const meta = fixMeta[row.id];
      const cls = classifyLiveRow(row, now);
      if (
        listTab === "moving" ||
        listTab === "idle" ||
        listTab === "off" ||
        listTab === "stale" ||
        listTab === "noFix"
      ) {
        if (cls !== listTab) return false;
      } else if (listTab === "alert") {
        if (!meta || !alertDeviceIds.has(meta.deviceId)) return false;
      } else if (listTab === "maintenance") {
        if (!(row.id > 0 && maintUserIds.has(row.id))) return false;
      }
      return true;
    });
  }, [searchFiltered, listTab, now, fixMeta, alertDeviceIds, maintUserIds]);

  const mapped = useMemo(
    () => filtered.filter((r) => r.lat !== null && r.lon !== null),
    [filtered],
  );

  const selected = rows.find((r) => r.id === selectedId) || null;
  const selectedMeta = selected ? fixMeta[selected.id] : null;
  const selectedCls = selected ? classifyLiveRow(selected, now) : null;

  // Do not include search text — refitting on every keystroke blanks/jitters the map.
  const fitKey = `${groupId}|${listTab}|${reload}`;

  const onSelect = useCallback((id: number | null) => setSelectedId(id), []);

  const openLiveVehicle = useCallback((id: number) => {
    setSelectedId(id);
    setSection("live");
  }, []);

  const tripDevices = useMemo(() => {
    const list: Array<{ deviceId: string; label: string }> = [];
    const seen = new Set<string>();
    for (const row of searchFiltered) {
      const meta = fixMeta[row.id];
      if (!meta?.deviceId || seen.has(meta.deviceId)) continue;
      seen.add(meta.deviceId);
      list.push({ deviceId: meta.deviceId, label: row.name });
    }
    return list;
  }, [searchFiltered, fixMeta]);

  const initialTripDeviceId = selectedMeta?.deviceId || tripDevices[0]?.deviceId || "";

  const statusBreakdown = useMemo(
    () =>
      LIVE_OPS_CLASSES.map((cls) => ({
        cls,
        n: counts[cls],
        pct: rows.length ? Math.round((counts[cls] / rows.length) * 100) : 0,
      })),
    [counts, rows.length],
  );

  return (
    <div className="app fleet-cc">
      <header className="fleet-cc-topbar">
        <div className="fleet-cc-brand">
          <BrandMark />
          <div>
            <h1>Fleet Live</h1>
            <p>
              Command center · gateway devices
              <span className="fleet-cc-live-pill">Live telemetry</span>
            </p>
          </div>
        </div>
        <div className="fleet-cc-top-actions">
          <button
            type="button"
            className="btn btn-ghost btn-compact fleet-cc-nav-toggle"
            aria-expanded={sideNavOpen}
            aria-controls="fleet-cc-sidenav"
            title={sideNavOpen ? "Hide menu" : "Show menu"}
            onClick={() => setSideNavOpen((v) => !v)}
          >
            {sideNavOpen ? "Hide menu" : "Menu"}
          </button>
          <ViewNav current="fleetLive" />
          <span className="fleet-cc-clock muted">{clockLabel(timezone)}</span>
          <a className="btn-ghost btn-compact" href={liveHref(typeof window !== "undefined" ? window.location.search : "")}>
            Armada Live
          </a>
          <button
            type="button"
            className="btn btn-compact"
            disabled={loading}
            onClick={() => setReload((n) => n + 1)}
          >
            {loading ? "Updating…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className={`fleet-cc-shell${sideNavOpen ? "" : " is-nav-collapsed"}`}>
        <aside
          id="fleet-cc-sidenav"
          className="fleet-cc-sidenav"
          aria-label="Fleet Live sections"
          hidden={!sideNavOpen}
        >
          <div className="fleet-cc-sidenav-head">
            <span>Sections</span>
            <button
              type="button"
              className="btn-link"
              onClick={() => setSideNavOpen(false)}
              aria-label="Collapse side menu"
            >
              Hide
            </button>
          </div>
          <nav className="fleet-cc-sidenav-nav">
            {allowedSections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={section === s.id ? "is-active" : ""}
                onClick={() => setSection(s.id)}
                disabled={!fleetModuleOk}
                aria-current={section === s.id ? "page" : undefined}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="fleet-cc-content">
      {!fleetModuleOk ? (
        <div className="banner error fleet-cc-banner">
          Fleet Live is disabled for this tenant. Enable module “Fleet Live (devices)” in Admin.
        </div>
      ) : null}
      {fleetModuleOk && deskUser?.id && !canViewLive ? (
        <div className="banner error fleet-cc-banner">
          Your desk account needs the “Fleet Live · map” privilege to use this page.
        </div>
      ) : null}

      <div className="fleet-cc-toolbar">
        {!sideNavOpen ? (
          <button
            type="button"
            className="btn btn-ghost btn-compact"
            onClick={() => setSideNavOpen(true)}
            title="Show section menu"
          >
            Menu · {sectionLabel}
          </button>
        ) : (
          <span className="fleet-cc-toolbar-section muted">{sectionLabel}</span>
        )}
        <label className="fleet-cc-field">
          <span>Device group</span>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{deviceGroups.length ? "All devices" : "No groups yet"}</option>
            {deviceGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.memberCount != null ? ` (${g.memberCount})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="fleet-cc-field">
          <span>Timezone</span>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fleet-cc-field fleet-cc-search">
          <span>Search</span>
          <input
            type="search"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Label, IMEI, group…"
          />
        </label>
        <div className="fleet-cc-toolbar-meta muted">
          {selectedGroup ? selectedGroup.name : "All devices"} · {filtered.length}/{rows.length}
        </div>
      </div>

      {(bootError || fetchError) && (
        <div className="banner error fleet-cc-banner">{bootError || fetchError}</div>
      )}

      {section === "dashboard" && fleetModuleOk ? (
        <FleetLiveDashboardPanel
          rows={searchFiltered}
          fixMeta={fixMeta}
          alerts={alerts}
          maintUserIds={maintUserIds}
          alertDeviceIds={alertDeviceIds}
          now={now}
          loading={loading}
          onOpenLive={openLiveVehicle}
          maintenanceHref={maintenanceHref(
            typeof window !== "undefined" ? window.location.search : "",
          )}
        />
      ) : null}

      {section === "ranking" && fleetModuleOk ? (
        <FleetLiveRankingPanel
          rows={searchFiltered}
          fixMeta={fixMeta}
          alertDeviceIds={alertDeviceIds}
          alertCounts={alertCounts24h}
          maintUserIds={maintUserIds}
          now={now}
          loading={loading}
          onOpenLive={openLiveVehicle}
        />
      ) : null}

      {section === "trips" && fleetModuleOk ? (
        <FleetLiveTripsPanel
          devices={tripDevices}
          timezone={timezone}
          initialDeviceId={initialTripDeviceId}
        />
      ) : null}

      {section === "history" && fleetModuleOk ? (
        <FleetLiveHistoryPanel
          devices={tripDevices}
          timezone={timezone}
          initialDeviceId={initialTripDeviceId}
        />
      ) : null}

      {section === "media" && fleetModuleOk ? (
        <FleetLiveMediaPanel
          devices={tripDevices}
          groupId={groupId}
          timezone={timezone}
          initialDeviceId={initialTripDeviceId}
        />
      ) : null}

      {section === "alerts" && fleetModuleOk ? (
        <FleetLiveAlertsPanel
          devices={tripDevices}
          groupId={groupId}
          timezone={timezone}
          initialDeviceId={initialTripDeviceId}
        />
      ) : null}

      {section === "live" && fleetModuleOk && canViewLive ? (
      <>
      <section className="fleet-cc-kpis" aria-label="Fleet KPIs">
        <div className="fleet-cc-kpi">
          <span className="fleet-cc-kpi-label">Total</span>
          <strong>{kpi.total}</strong>
        </div>
        <div className="fleet-cc-kpi is-moving">
          <span className="fleet-cc-kpi-label">Moving</span>
          <strong>{kpi.moving}</strong>
        </div>
        <div className="fleet-cc-kpi is-idle">
          <span className="fleet-cc-kpi-label">Idle</span>
          <strong>{kpi.idle}</strong>
        </div>
        <div className="fleet-cc-kpi is-off">
          <span className="fleet-cc-kpi-label">Off</span>
          <strong>{kpi.off}</strong>
        </div>
        <div className="fleet-cc-kpi is-stale">
          <span className="fleet-cc-kpi-label">Stale / no fix</span>
          <strong>{kpi.stale}</strong>
        </div>
        <div className="fleet-cc-kpi is-alert">
          <span className="fleet-cc-kpi-label">Alert (24h)</span>
          <strong>{kpi.alerts}</strong>
        </div>
        <div className="fleet-cc-kpi is-maint">
          <span className="fleet-cc-kpi-label">Maintenance</span>
          <strong>{kpi.maintenance}</strong>
        </div>
        <div className="fleet-cc-kpi">
          <span className="fleet-cc-kpi-label">Avg fuel</span>
          <strong>{kpi.avgFuel != null ? `${kpi.avgFuel}%` : "—"}</strong>
        </div>
      </section>

      <div className="fleet-cc-main">
        <div className="fleet-cc-map-pane">
          <div className="fleet-cc-map-wrap map-wrap">
            <LiveOpsMap
              rows={mapped}
              now={now}
              fitKey={fitKey}
              selectedId={selectedId}
              onSelect={onSelect}
            />
            <div className="fleet-cc-map-legend" aria-hidden>
              {LIVE_OPS_CLASSES.map((cls) => (
                <span key={cls}>
                  <i style={{ background: LIVE_OPS_COLORS[cls] }} />
                  {LIVE_OPS_LABELS[cls]}
                </span>
              ))}
            </div>
            {selected && selectedCls ? (
              <aside className="fleet-cc-sel-card">
                <header>
                  <strong>{selected.name}</strong>
                  <span
                    className={`fleet-cc-badge is-${selectedCls}`}
                    style={{ background: LIVE_OPS_COLORS[selectedCls] }}
                  >
                    {LIVE_OPS_LABELS[selectedCls]}
                  </span>
                </header>
                <dl>
                  <div>
                    <dt>Speed</dt>
                    <dd>
                      {selected.speedKmh == null ? "—" : `${formatSpeed(selected.speedKmh)} km/h`}
                    </dd>
                  </div>
                  <div>
                    <dt>Fuel</dt>
                    <dd>
                      {selectedMeta?.fuelLevel != null
                        ? `${Math.round(selectedMeta.fuelLevel)}%`
                        : selectedMeta?.fuelLiters != null
                          ? `${selectedMeta.fuelLiters.toFixed(1)} L`
                          : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Odometer</dt>
                    <dd>
                      {selectedMeta?.odometerKm != null
                        ? `${formatKm(selectedMeta.odometerKm)} km`
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Age</dt>
                    <dd>{ageLabel(selected.lastMs, now)}</dd>
                  </div>
                  <div>
                    <dt>IMEI</dt>
                    <dd>{selectedMeta?.imei || selected.username || "—"}</dd>
                  </div>
                  <div>
                    <dt>Groups</dt>
                    <dd>{selectedMeta?.groups || "—"}</dd>
                  </div>
                </dl>
                {selected.id > 0 ? (
                  <div className="fleet-cc-sel-links">
                    <a href={tripsHref(vehicleSearch(selected.id))}>Trips</a>
                    <a href={fullHref(vehicleSearch(selected.id))}>Full</a>
                    <a href={maintenanceOpenHref(selected.id)}>Maintenance</a>
                  </div>
                ) : null}
                <button type="button" className="btn-link" onClick={() => setSelectedId(null)}>
                  Clear selection
                </button>
              </aside>
            ) : null}
          </div>
        </div>

        <aside className="fleet-cc-list-pane">
          <header className="fleet-cc-list-head">
            <h2>
              Live vehicles <span className="muted">{filtered.length}/{rows.length}</span>
            </h2>
          </header>
          <div className="fleet-cc-tabs" role="tablist">
            {LIST_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={listTab === tab.id}
                className={listTab === tab.id ? "active" : ""}
                onClick={() => setListTab(tab.id)}
              >
                {tab.label}
                <em>
                  {tab.id === "all"
                    ? tabCounts.all
                    : tab.id === "alert"
                      ? tabCounts.alert
                      : tab.id === "maintenance"
                        ? tabCounts.maintenance
                        : tabCounts[tab.id] ?? 0}
                </em>
              </button>
            ))}
          </div>
          <ul className="fleet-cc-vehicle-list">
            {filtered.length === 0 ? (
              <li className="fleet-cc-empty muted">
                {loading ? "Loading…" : "No vehicles match filters."}
              </li>
            ) : (
              filtered.map((row) => {
                const cls = classifyLiveRow(row, now);
                const meta = fixMeta[row.id];
                const inAlert = meta ? alertDeviceIds.has(meta.deviceId) : false;
                const inMaint = row.id > 0 && maintUserIds.has(row.id);
                const fuel = meta?.fuelLevel;
                return (
                  <li key={row.id} className={selectedId === row.id ? "is-selected" : ""}>
                    <button type="button" onClick={() => setSelectedId(row.id)}>
                      <span
                        className="fleet-cc-dot"
                        style={{ background: LIVE_OPS_COLORS[cls] }}
                      />
                      <span className="fleet-cc-vmain">
                        <span className="fleet-cc-vtitle">
                          <strong>{row.name}</strong>
                          {inAlert ? <span className="fleet-cc-chip is-alert">Alert</span> : null}
                          {inMaint ? <span className="fleet-cc-chip is-maint">Maint</span> : null}
                        </span>
                        <span className="muted">
                          {LIVE_OPS_LABELS[cls]} · {ageLabel(row.lastMs, now)} ·{" "}
                          {row.speedKmh == null ? "—" : `${formatSpeed(row.speedKmh)} km/h`}
                          {meta?.odometerKm != null ? ` · ${formatKm(meta.odometerKm)} km` : ""}
                        </span>
                        {fuel != null ? (
                          <span className="fleet-cc-fuelbar" title={`Fuel ${Math.round(fuel)}%`}>
                            <span style={{ width: `${Math.max(0, Math.min(100, fuel))}%` }} />
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>
      </div>

      <section className="fleet-cc-bottom">
        <div className="fleet-cc-alerts">
          <header>
            <h3>
              Alerts feed <span className="muted">{alerts.length}</span>
            </h3>
            <button type="button" className="btn-link" onClick={() => setAlertsOpen((v) => !v)}>
              {alertsOpen ? "Hide" : "Show"}
            </button>
          </header>
          {alertsOpen ? (
            alerts.length === 0 ? (
              <p className="muted">No recent safety events.</p>
            ) : (
              <ul>
                {(alertsOpen ? alerts : []).slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <span
                      className={`fleet-cc-alert-lvl is-l${Math.min(3, Math.max(0, a.alarmLevel || 0))}`}
                    />
                    <div>
                      <strong>{alarmLabel(a.alarmType)}</strong>
                      <span className="muted">
                        {" "}
                        · {a.deviceLabel || a.imei || a.deviceId.slice(0, 8)}
                        {a.sourceProtocol ? ` · ${a.sourceProtocol}` : ""}
                      </span>
                      <div className="muted">
                        {a.recordedAt ? new Date(a.recordedAt).toLocaleString() : "—"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>

        <div className="fleet-cc-breakdown">
          <h3>Status breakdown</h3>
          <ul>
            {statusBreakdown.map(({ cls, n, pct }) => (
              <li key={cls}>
                <span className="fleet-cc-break-label">
                  <i style={{ background: LIVE_OPS_COLORS[cls] }} />
                  {LIVE_OPS_LABELS[cls]}
                </span>
                <span className="fleet-cc-break-bar">
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
      </>
      ) : null}
        </div>
      </div>
    </div>
  );
}
