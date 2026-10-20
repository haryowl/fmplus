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
  fetchDeviceGroupScope,
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
import {
  IcoAlerts,
  IcoAttention,
  IcoChevronDown,
  IcoChevronUp,
  IcoClose,
  IcoCollapse,
  IcoFleet,
  IcoFuel,
  IcoGroup,
  IcoLive,
  IcoMenu,
  IcoRefresh,
  IcoRules,
  IcoSearch,
  IcoUtil,
  IcoWrench,
  IcoZone,
  SECTION_ICONS,
} from "../components/fleetLiveIcons";
import { FleetLiveParamsPanel } from "../components/FleetLiveParamsPanel";
import {
  FLEET_DASH_PIN_COLUMNS,
  formatDisplayPinValue,
  readDisplayPin,
} from "../lib/fleetTelemetryParams";
import { LiveOpsMap } from "../components/LiveOpsMap";
import { ViewNav } from "../components/ViewNav";
import {
  ackRuleEvent,
  fetchRuleEvents,
  fetchRuleHolds,
  formatHoldClock,
  resolveRuleEvent,
  type FleetRuleEvent,
  type FleetRuleHold,
} from "../lib/fleetAlertRules";

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
  displayParams: Record<string, string | number | boolean>;
};

const LIST_TABS: { id: ListTab; label: string; short: string }[] = [
  { id: "all", label: "All vehicles", short: "All" },
  { id: "moving", label: "Moving", short: "Move" },
  { id: "idle", label: "Idle", short: "Idle" },
  { id: "off", label: "Ignition off", short: "Off" },
  { id: "stale", label: "Stale / no fix", short: "Stale" },
  { id: "alert", label: "Alert (24h)", short: "Alert" },
  { id: "maintenance", label: "Open maintenance", short: "Maint" },
];

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params.set("userId", String(userId));
  params.delete("userIds");
  const q = params.toString();
  return q ? `?${q}` : "";
}

async function fetchSafetyEvents(
  signal?: AbortSignal,
  opts?: { groupId?: string },
): Promise<SafetyEvent[]> {
  const q = new URLSearchParams({ limit: "40" });
  if (opts?.groupId) q.set("groupId", opts.groupId);
  const res = await fetch(`/api/tracker/safety-events?${q}`, {
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
  const [ruleFires, setRuleFires] = useState<FleetRuleEvent[]>([]);
  const [ruleHolds, setRuleHolds] = useState<FleetRuleHold[]>([]);
  const [maintUserIds, setMaintUserIds] = useState<Set<number>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [listTab, setListTab] = useState<ListTab>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [queryText, setQueryText] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(() => {
    try {
      return localStorage.getItem("fmplus.fleetLive.drawer") === "1";
    } catch {
      return false;
    }
  });
  const [locateToken, setLocateToken] = useState("");
  const [selParamsOpen, setSelParamsOpen] = useState(false);
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

  useEffect(() => {
    try {
      localStorage.setItem("fmplus.fleetLive.drawer", alertsOpen ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [alertsOpen]);

  const fleetModuleOk = moduleAllowed("fleetLive");
  const canViewLive =
    !deskUser?.id || deskCanWrite(deskUser, deskPrivileges, "viewFleetLive");
  const canViewRules = entitlements.features.fleetLiveRules !== false;
  const canManageRules = deskCanWrite(deskUser, deskPrivileges, "manageFleetRules");
  const canAckAlerts = deskCanWrite(deskUser, deskPrivileges, "ackFleetAlerts");
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
        fetchSafetyEvents(ac.signal, { groupId: groupId || undefined }).catch(
          () => [] as SafetyEvent[],
        ),
        fetchRuleEvents({ status: "open", limit: 40 }, ac.signal).catch(
          () => [] as FleetRuleEvent[],
        ),
        fetchRuleHolds({ limit: 20 }, ac.signal).catch(() => [] as FleetRuleHold[]),
        fetchOpenMaintenanceUserIds(ac.signal).catch(() => new Set<number>()),
        groupId
          ? fetchDeviceGroupScope([groupId], ac.signal).catch(() => null)
          : Promise.resolve(null),
      ])
        .then(([deviceStatus, safety, openRules, holds, maintIds, groupScope]) => {
          if (ac.signal.aborted) return;
          const nextRows: LastStatusRow[] = [];
          const meta: Record<number, FixMeta> = {};
          const groupDeviceIds = groupScope
            ? new Set(groupScope.deviceIds)
            : null;
          const groupArmadaIds = groupScope
            ? new Set(groupScope.armadaUserIds)
            : null;
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
              displayParams: fix.displayParams || {},
            };
          }
          setRows(nextRows);
          setFixMeta(meta);
          setAlerts(safety);
          setRuleFires(
            groupDeviceIds
              ? openRules.filter((e) => !e.deviceId || groupDeviceIds.has(e.deviceId))
              : openRules,
          );
          setRuleHolds(
            groupDeviceIds
              ? holds.filter((h) => groupDeviceIds.has(h.deviceId))
              : holds,
          );
          setMaintUserIds(
            groupArmadaIds
              ? new Set([...maintIds].filter((id) => groupArmadaIds.has(id)))
              : maintIds,
          );
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

  // Drop stale markers immediately on group change so the map does not fit
  // the previous group's coordinates before the new fetch returns.
  useEffect(() => {
    setLoading(true);
    setRows([]);
    setFixMeta({});
    setSelectedId(null);
  }, [groupId]);

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
    for (const r of ruleFires) {
      if (r.deviceId) set.add(r.deviceId);
    }
    return set;
  }, [alerts, ruleFires]);

  const drawerAlertCount = alerts.length + ruleFires.length;

  const drawerFeed = useMemo(() => {
    type Item = {
      key: string;
      kind: "safety" | "rule";
      eventId?: string;
      title: string;
      device: string;
      atMs: number;
      atLabel: string;
      level: number;
      pill: string;
    };
    const items: Item[] = [];
    for (const a of alerts) {
      const atMs = Date.parse(a.recordedAt);
      items.push({
        key: `s-${a.id}`,
        kind: "safety",
        title: alarmLabel(a.alarmType),
        device: a.deviceLabel || a.imei || a.deviceId.slice(0, 8),
        atMs: Number.isFinite(atMs) ? atMs : 0,
        atLabel: a.recordedAt ? new Date(a.recordedAt).toLocaleString() : "—",
        level: Math.min(3, Math.max(0, a.alarmLevel || 0)),
        pill: "Safety",
      });
    }
    for (const r of ruleFires) {
      const atMs = Date.parse(r.firedAt);
      items.push({
        key: `r-${r.id}`,
        kind: "rule",
        eventId: r.id,
        title: r.title,
        device: r.deviceLabel || "device",
        atMs: Number.isFinite(atMs) ? atMs : 0,
        atLabel: r.firedAt ? new Date(r.firedAt).toLocaleString() : "—",
        level: r.severity === "critical" ? 3 : r.severity === "warning" ? 2 : 1,
        pill: "Open",
      });
    }
    items.sort((a, b) => b.atMs - a.atMs);
    return items.slice(0, 12);
  }, [alerts, ruleFires]);

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
  const selectedPins = FLEET_DASH_PIN_COLUMNS.filter(
    (c) => c.id !== "fuel_level" && c.id !== "can.fuel_l",
  )
    .map((col) => {
      const v = readDisplayPin(selectedMeta?.displayParams, col);
      if (v == null) return null;
      return { id: col.id, label: col.label, value: formatDisplayPinValue(v) };
    })
    .filter((p): p is { id: string; label: string; value: string } => p != null);

  // Do not include search text — refitting on every keystroke blanks/jitters the map.
  const fitKey = `${groupId}|${listTab}|${reload}`;

  const onSelect = useCallback((id: number | null) => {
    setSelectedId(id);
    if (id != null) setLocateToken(`${id}:${Date.now()}`);
  }, []);

  const openLiveVehicle = useCallback((id: number) => {
    setSelectedId(id);
    setLocateToken(`${id}:${Date.now()}`);
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

  const onlineCount = kpi.moving + kpi.idle;

  const liveInsights = useMemo(() => {
    const chips: Array<{ id: string; tone: "idle" | "stale" | "alert"; label: string; tab: ListTab }> =
      [];
    if (kpi.idle > 0) {
      chips.push({
        id: "idle",
        tone: "idle",
        label: `${kpi.idle} idle unit${kpi.idle === 1 ? "" : "s"}`,
        tab: "idle",
      });
    }
    if (kpi.stale > 0) {
      chips.push({
        id: "stale",
        tone: "stale",
        label: `${kpi.stale} stale / no-fix need check`,
        tab: "stale",
      });
    }
    if (kpi.alerts > 0) {
      chips.push({
        id: "alert",
        tone: "alert",
        label: `${kpi.alerts} with alerts (24h)`,
        tab: "alert",
      });
    }
    return chips;
  }, [kpi.idle, kpi.stale, kpi.alerts]);

  const insightLine = useMemo(() => {
    const bits: string[] = [];
    if (kpi.idle) bits.push(`${kpi.idle} idle`);
    if (kpi.stale) bits.push(`${kpi.stale} stale`);
    if (kpi.alerts) bits.push(`${kpi.alerts} alert units`);
    if (kpi.maintenance) bits.push(`${kpi.maintenance} maint`);
    return bits.length ? bits.join(" · ") : "Fleet looks clear";
  }, [kpi.idle, kpi.stale, kpi.alerts, kpi.maintenance]);

  const mixDominant = useMemo(() => {
    let best = statusBreakdown[0];
    for (const row of statusBreakdown) {
      if (row.n > (best?.n || 0)) best = row;
    }
    return best;
  }, [statusBreakdown]);

  const donut = useMemo(() => {
    const r = 34;
    const c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = statusBreakdown
      .filter((x) => x.n > 0)
      .map((x) => {
        const len = (x.pct / 100) * c;
        const arc = {
          cls: x.cls,
          color: LIVE_OPS_COLORS[x.cls],
          dash: `${len} ${c - len}`,
          offset,
        };
        offset -= len;
        return arc;
      });
    return { r, c, arcs };
  }, [statusBreakdown]);

  return (
    <div className="app fleet-cc">
      <header className="fleet-cc-topbar">
        <div className="fleet-cc-brand">
          <BrandMark />
          <div>
            <h1>Fleet Live</h1>
            <p>
              <span className="fleet-cc-live-dot" aria-hidden />
              Gateway devices · {clockLabel(timezone)}
            </p>
          </div>
        </div>
        <div className="fleet-cc-top-actions">
          <button
            type="button"
            className="fleet-cc-icon-btn fleet-cc-nav-toggle"
            aria-expanded={sideNavOpen}
            aria-controls="fleet-cc-sidenav"
            title={sideNavOpen ? "Hide menu" : "Show menu"}
            aria-label={sideNavOpen ? "Hide menu" : "Show menu"}
            onClick={() => setSideNavOpen((v) => !v)}
          >
            {sideNavOpen ? <IcoCollapse /> : <IcoMenu />}
          </button>
          <ViewNav current="fleetLive" />
          <a
            className="fleet-cc-icon-btn"
            href={liveHref(typeof window !== "undefined" ? window.location.search : "")}
            title="Armada Live"
            aria-label="Armada Live"
          >
            <IcoLive />
          </a>
          <button
            type="button"
            className="btn btn-primary btn-compact fleet-cc-refresh"
            disabled={loading}
            title="Refresh"
            aria-label={loading ? "Updating" : "Refresh"}
            onClick={() => setReload((n) => n + 1)}
          >
            <IcoRefresh className={loading ? "is-spin" : undefined} />
            <span className="fleet-cc-btn-label">{loading ? "Updating" : "Refresh"}</span>
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
              className="fleet-cc-icon-btn"
              onClick={() => setSideNavOpen(false)}
              aria-label="Collapse side menu"
              title="Collapse"
            >
              <IcoCollapse />
            </button>
          </div>
          <nav className="fleet-cc-sidenav-nav">
            {allowedSections.map((s) => {
              const Icon = SECTION_ICONS[s.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  className={section === s.id ? "is-active" : ""}
                  onClick={() => setSection(s.id)}
                  disabled={!fleetModuleOk}
                  aria-current={section === s.id ? "page" : undefined}
                  title={s.label}
                >
                  <Icon />
                  <span>{s.label}</span>
                </button>
              );
            })}
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
            className="fleet-cc-icon-btn fleet-cc-menu-open"
            onClick={() => setSideNavOpen(true)}
            title={`Show menu · ${sectionLabel}`}
            aria-label={`Show menu · ${sectionLabel}`}
          >
            {(() => {
              const Icon = SECTION_ICONS[section];
              return <Icon />;
            })()}
            <span className="fleet-cc-btn-label">{sectionLabel}</span>
          </button>
        ) : (
          <span className="fleet-cc-toolbar-section">
            {(() => {
              const Icon = SECTION_ICONS[section];
              return <Icon />;
            })()}
            {sectionLabel}
          </span>
        )}
        <label className="fleet-cc-field fleet-cc-field-ico">
          <span>
            <IcoGroup /> Group
          </span>
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
        <label className="fleet-cc-field fleet-cc-field-ico">
          <span>
            <IcoZone /> Zone
          </span>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fleet-cc-field fleet-cc-search fleet-cc-field-ico">
          <span className="sr-only">Search</span>
          <span className="fleet-cc-search-wrap">
            <IcoSearch />
            <input
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Label, IMEI, group…"
            />
          </span>
        </label>
        <div className="fleet-cc-toolbar-meta" title="Shown / total">
          <IcoFleet />
          <span>
            {filtered.length}/{rows.length}
          </span>
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
          groups={deviceGroups}
          groupId={groupId}
          timezone={timezone}
          initialDeviceId={initialTripDeviceId}
          canViewRules={canViewRules}
          canManageRules={canManageRules}
          canAckAlerts={canAckAlerts}
        />
      ) : null}

      {section === "live" && fleetModuleOk && canViewLive ? (
      <>
      <section className="fleet-cc-status-strip" aria-label="Fleet status filters">
        <div className="fleet-cc-filter-row">
          {(
            [
              { id: "all" as ListTab, label: "Fleet", n: kpi.total, icon: "fleet" as const },
              { id: "moving" as ListTab, label: "Move", n: kpi.moving, icon: "dot" as const, color: LIVE_OPS_COLORS.moving },
              { id: "idle" as ListTab, label: "Idle", n: kpi.idle, icon: "dot" as const, color: LIVE_OPS_COLORS.idle },
              { id: "off" as ListTab, label: "Off", n: kpi.off, icon: "dot" as const, color: LIVE_OPS_COLORS.off },
              { id: "stale" as ListTab, label: "Stale", n: kpi.stale, icon: "dot" as const, color: LIVE_OPS_COLORS.stale },
              { id: "alert" as ListTab, label: "Alert", n: kpi.alerts, icon: "alert" as const },
              { id: "maintenance" as ListTab, label: "Maint", n: kpi.maintenance, icon: "maint" as const },
            ] as const
          ).map((pill) => (
            <button
              key={pill.id}
              type="button"
              className={`fleet-cc-filter-pill${listTab === pill.id ? " is-active" : ""}${
                "color" in pill && pill.id !== "all" ? ` is-${pill.id}` : ""
              }`}
              aria-pressed={listTab === pill.id}
              title={`${pill.label}: ${pill.n}`}
              onClick={() => setListTab(pill.id)}
            >
              {pill.icon === "fleet" ? (
                <IcoFleet />
              ) : pill.icon === "alert" ? (
                <IcoAlerts />
              ) : pill.icon === "maint" ? (
                <IcoWrench />
              ) : (
                <span className="fleet-cc-stat-dot" style={{ background: pill.color }} />
              )}
              <span className="fleet-cc-filter-label">{pill.label}</span>
              <em>{pill.n}</em>
            </button>
          ))}
          <div className="fleet-cc-filter-fuel" title="Average fuel">
            <IcoFuel />
            <strong>{kpi.avgFuel != null ? `${kpi.avgFuel}%` : "—"}</strong>
            <span>Fuel</span>
          </div>
        </div>
        <div className="fleet-cc-filter-meta">
          <span className={`fleet-cc-telem${fetchError ? " is-bad" : " is-ok"}`}>
            {fetchError ? "Telematics issue" : "Telematics OK"}
          </span>
          <button
            type="button"
            className="fleet-cc-filter-alert-n"
            onClick={() => {
              setAlertsOpen(true);
              setListTab("alert");
            }}
          >
            <IcoAlerts /> {drawerAlertCount} alerts
          </button>
          {kpi.idle > 0 ? (
            <button
              type="button"
              className="fleet-cc-filter-spotlight"
              onClick={() => setListTab("idle")}
            >
              {kpi.idle} idle
            </button>
          ) : null}
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
              locateToken={locateToken}
            />
            {liveInsights.length ? (
              <div className="fleet-cc-map-insights">
                {liveInsights.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`fleet-cc-insight is-${chip.tone}`}
                    onClick={() => setListTab(chip.tab)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="fleet-cc-map-legend" aria-hidden>
              {LIVE_OPS_CLASSES.map((cls) => (
                <span key={cls}>
                  <i style={{ background: LIVE_OPS_COLORS[cls] }} />
                  {LIVE_OPS_LABELS[cls]}
                  <em>{counts[cls]}</em>
                </span>
              ))}
            </div>
            {selected && selectedCls ? (
              <aside className="fleet-cc-sel-card">
                <header>
                  <div>
                    <strong>{selected.name}</strong>
                    <p className="muted">
                      {selectedMeta?.groups || selectedMeta?.imei || selected.username || "—"}
                      {" · "}
                      {ageLabel(selected.lastMs, now)}
                    </p>
                  </div>
                  <span
                    className={`fleet-cc-badge is-${selectedCls}`}
                    style={{ background: LIVE_OPS_COLORS[selectedCls] }}
                  >
                    {LIVE_OPS_LABELS[selectedCls]}
                  </span>
                  <button
                    type="button"
                    className="fleet-cc-icon-btn fleet-cc-sel-close"
                    onClick={() => setSelectedId(null)}
                    title="Clear selection"
                    aria-label="Clear selection"
                  >
                    <IcoClose />
                  </button>
                </header>
                <div className="fleet-cc-sel-metrics">
                  <div>
                    <span>Speed</span>
                    <strong>
                      {selected.speedKmh == null ? "—" : `${formatSpeed(selected.speedKmh)}`}
                      <em> km/h</em>
                    </strong>
                  </div>
                  <div>
                    <span>Odometer</span>
                    <strong>
                      {selectedMeta?.odometerKm != null ? formatKm(selectedMeta.odometerKm) : "—"}
                      <em> km</em>
                    </strong>
                  </div>
                  <div>
                    <span>Fuel</span>
                    <strong>
                      {selectedMeta?.fuelLevel != null
                        ? `${Math.round(selectedMeta.fuelLevel)}%`
                        : selectedMeta?.fuelLiters != null
                          ? `${selectedMeta.fuelLiters.toFixed(1)} L`
                          : "—"}
                    </strong>
                  </div>
                </div>
                {selectedPins.length ? (
                  <div className="fleet-cc-sel-pins" aria-label="Pinned mapper parameters">
                    {selectedPins.map((p) => (
                      <div key={p.id} title={p.id}>
                        <span>{p.label}</span>
                        <strong>{p.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="fleet-cc-sel-flags">
                  {selectedMeta && alertDeviceIds.has(selectedMeta.deviceId) ? (
                    <span className="fleet-cc-chip is-alert" title="Alert 24h">
                      <IcoAlerts /> Alert
                    </span>
                  ) : null}
                  {selected.id > 0 && maintUserIds.has(selected.id) ? (
                    <span className="fleet-cc-chip is-maint" title="Maintenance">
                      <IcoWrench /> Maint
                    </span>
                  ) : null}
                </div>
                <div className="fleet-cc-sel-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    onClick={() => setSection("history")}
                  >
                    View history
                  </button>
                  <button
                    type="button"
                    className={`btn btn-primary btn-compact${selParamsOpen ? " is-active" : ""}`}
                    onClick={() => setSelParamsOpen((v) => !v)}
                    title="Device mapper parameters"
                    aria-pressed={selParamsOpen}
                  >
                    {selParamsOpen ? "Hide params" : "Params"}
                  </button>
                  {selected.id > 0 ? (
                    <a className="fleet-cc-icon-btn" href={tripsHref(vehicleSearch(selected.id))}>
                      Trips
                    </a>
                  ) : null}
                </div>
                {selParamsOpen && selectedMeta?.deviceId ? (
                  <FleetLiveParamsPanel mode="live" deviceId={selectedMeta.deviceId} />
                ) : null}
              </aside>
            ) : null}
          </div>
        </div>

        <aside className="fleet-cc-list-pane">
          <header className="fleet-cc-list-head">
            <div>
              <h2>
                <IcoFleet /> Vehicles
              </h2>
              <p className="fleet-cc-list-sub muted">
                {filtered.length}/{rows.length} shown
                {onlineCount ? ` · ${onlineCount} online` : ""}
              </p>
            </div>
            <span className="fleet-cc-list-live">
              <span className="fleet-cc-live-dot" /> Live
            </span>
          </header>
          <div className="fleet-cc-tabs" role="tablist">
            {LIST_TABS.map((tab) => {
              const n =
                tab.id === "all"
                  ? tabCounts.all
                  : tab.id === "alert"
                    ? tabCounts.alert
                    : tab.id === "maintenance"
                      ? tabCounts.maintenance
                      : tabCounts[tab.id] ?? 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={listTab === tab.id}
                  aria-label={`${tab.label}: ${n}`}
                  title={`${tab.label}: ${n}`}
                  className={listTab === tab.id ? "active" : ""}
                  onClick={() => setListTab(tab.id)}
                >
                  {tab.id === "alert" ? (
                    <IcoAlerts />
                  ) : tab.id === "maintenance" ? (
                    <IcoWrench />
                  ) : tab.id === "all" ? (
                    <IcoFleet />
                  ) : (
                    <span
                      className="fleet-cc-tab-dot"
                      style={{
                        background:
                          tab.id === "moving"
                            ? LIVE_OPS_COLORS.moving
                            : tab.id === "idle"
                              ? LIVE_OPS_COLORS.idle
                              : tab.id === "off"
                                ? LIVE_OPS_COLORS.off
                                : LIVE_OPS_COLORS.stale,
                      }}
                    />
                  )}
                  <span className="fleet-cc-tab-label">{tab.short}</span>
                  <em>{n}</em>
                </button>
              );
            })}
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
                    <button type="button" onClick={() => onSelect(row.id)}>
                      <span
                        className="fleet-cc-dot"
                        style={{ background: LIVE_OPS_COLORS[cls] }}
                      />
                      <span className="fleet-cc-vmain">
                        <span className="fleet-cc-vtitle">
                          <strong>{row.name}</strong>
                          <span
                            className="fleet-cc-vstatus"
                            style={{ color: LIVE_OPS_COLORS[cls] }}
                          >
                            {LIVE_OPS_LABELS[cls]}
                          </span>
                          {inAlert ? (
                            <span className="fleet-cc-chip is-alert" title="Alert 24h">
                              <IcoAlerts />
                            </span>
                          ) : null}
                          {inMaint ? (
                            <span className="fleet-cc-chip is-maint" title="Maintenance">
                              <IcoWrench />
                            </span>
                          ) : null}
                        </span>
                        <span className="muted fleet-cc-vline">
                          <span>{row.speedKmh == null ? "—" : `${formatSpeed(row.speedKmh)} km/h`}</span>
                          <span>{ageLabel(row.lastMs, now)}</span>
                          {fuel != null ? <span>{Math.round(fuel)}% fuel</span> : null}
                        </span>
                        {fuel != null ? (
                          <span className="fleet-cc-fuelbar" title={`Fuel ${Math.round(fuel)}%`}>
                            <span style={{ width: `${Math.max(0, Math.min(100, fuel))}%` }} />
                          </span>
                        ) : null}
                      </span>
                      <span className="fleet-cc-vodo">
                        {meta?.odometerKm != null ? `${formatKm(meta.odometerKm)}` : "—"}
                        <em>km</em>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="fleet-cc-insight-card">
            <div>
              <strong>Fleet insight</strong>
              <p className="muted">{insightLine}</p>
            </div>
            <button
              type="button"
              className="fleet-cc-icon-btn"
              onClick={() => {
                if (kpi.stale) setListTab("stale");
                else if (kpi.alerts) setListTab("alert");
                else if (kpi.idle) setListTab("idle");
                else setAlertsOpen(true);
              }}
            >
              Resolve
            </button>
          </div>
        </aside>
      </div>

      <section className={`fleet-cc-drawer${alertsOpen ? " is-open" : ""}`}>
        <button
          type="button"
          className="fleet-cc-drawer-toggle"
          onClick={() => setAlertsOpen((v) => !v)}
          aria-expanded={alertsOpen}
        >
          <span className="fleet-cc-drawer-title">
            <IcoAlerts />
            <strong>{drawerAlertCount}</strong>
            <span className="muted">alerts</span>
            {ruleFires.length > 0 ? (
              <>
                <span className="fleet-cc-drawer-sep" />
                <IcoRules />
                <strong>{ruleFires.length}</strong>
                <span className="muted">rules</span>
              </>
            ) : null}
            {ruleHolds.length > 0 ? (
              <>
                <span className="fleet-cc-drawer-sep" />
                <IcoAttention />
                <strong>{ruleHolds.length}</strong>
                <span className="muted">holding</span>
              </>
            ) : null}
            {!alertsOpen && onlineCount > 0 ? (
              <>
                <span className="fleet-cc-drawer-sep" />
                <span className="fleet-cc-stat-dot" style={{ background: LIVE_OPS_COLORS.moving }} />
                <strong>{kpi.moving}</strong>
                <span className="fleet-cc-stat-dot" style={{ background: LIVE_OPS_COLORS.idle }} />
                <strong>{kpi.idle}</strong>
              </>
            ) : null}
          </span>
          <em aria-hidden>{alertsOpen ? <IcoChevronDown /> : <IcoChevronUp />}</em>
        </button>
        {alertsOpen ? (
          <div className="fleet-cc-bottom">
            <div className="fleet-cc-alerts">
              <header className="fleet-cc-panel-head">
                <h3>
                  <IcoAlerts /> Alerts <span className="muted">{drawerAlertCount}</span>
                </h3>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setSection("alerts")}
                >
                  View all
                </button>
              </header>
              {ruleHolds.length ? (
                <div className="fleet-cc-holds">
                  <header className="fleet-cc-panel-head">
                    <h3>
                      <IcoAttention /> Holding <span className="muted">{ruleHolds.length}</span>
                    </h3>
                  </header>
                  <ul>
                    {ruleHolds.slice(0, 5).map((h) => (
                      <li key={`${h.ruleId}:${h.deviceId}`}>
                        <div>
                          <strong>{h.ruleName}</strong>
                          <span className="muted"> · {h.deviceLabel || "device"}</span>
                          <div className="fleet-hold-bar" aria-hidden>
                            <span style={{ width: `${h.progress}%` }} />
                          </div>
                          <div className="muted">
                            {formatHoldClock(h.heldSec)} / {formatHoldClock(h.durationSec)} ·{" "}
                            {h.phase}
                          </div>
                        </div>
                        <em className="fleet-cc-active-pill is-hold">{h.progress}%</em>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {drawerFeed.length === 0 ? (
                <p className="muted">No recent safety or rule events.</p>
              ) : (
                <ul>
                  {drawerFeed.map((item) => (
                    <li key={item.key}>
                      <span className={`fleet-cc-alert-lvl is-l${item.level}`} />
                      <div>
                        <strong>
                          {item.kind === "rule" ? <IcoRules /> : null}
                          {item.kind === "rule" ? " " : null}
                          {item.title}
                        </strong>
                        <span className="muted"> · {item.device}</span>
                        <div className="muted">{item.atLabel}</div>
                      </div>
                      {item.kind === "rule" && item.eventId && canAckAlerts ? (
                        <div className="fleet-cc-drawer-actions">
                          <button
                            type="button"
                            className="fleet-cc-icon-btn"
                            title="Acknowledge"
                            onClick={() =>
                              void ackRuleEvent(item.eventId!)
                                .then(() =>
                                  setRuleFires((prev) =>
                                    prev.filter((x) => x.id !== item.eventId),
                                  ),
                                )
                                .catch((err: Error) => setFetchError(err.message))
                            }
                          >
                            Ack
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-compact"
                            title="Resolve"
                            onClick={() =>
                              void resolveRuleEvent(item.eventId!)
                                .then(() =>
                                  setRuleFires((prev) =>
                                    prev.filter((x) => x.id !== item.eventId),
                                  ),
                                )
                                .catch((err: Error) => setFetchError(err.message))
                            }
                          >
                            Resolve
                          </button>
                        </div>
                      ) : (
                        <em
                          className={`fleet-cc-active-pill${
                            item.kind === "rule" ? " is-rule" : " is-safety"
                          }`}
                        >
                          {item.pill}
                        </em>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="fleet-cc-breakdown">
              <header className="fleet-cc-panel-head">
                <h3>
                  <IcoUtil /> Mix &amp; utilization
                </h3>
                <span className="muted">Now</span>
              </header>
              <div className="fleet-cc-mix-grid">
                <div className="fleet-cc-donut" aria-hidden>
                  <svg viewBox="0 0 96 96" width="96" height="96">
                    <circle
                      cx="48"
                      cy="48"
                      r={donut.r}
                      fill="none"
                      stroke="var(--line, #d5e0e6)"
                      strokeWidth="10"
                    />
                    {donut.arcs.map((arc) => (
                      <circle
                        key={arc.cls}
                        cx="48"
                        cy="48"
                        r={donut.r}
                        fill="none"
                        stroke={arc.color}
                        strokeWidth="10"
                        strokeDasharray={arc.dash}
                        strokeDashoffset={arc.offset}
                        strokeLinecap="butt"
                        transform="rotate(-90 48 48)"
                      />
                    ))}
                  </svg>
                  <div className="fleet-cc-donut-label">
                    <strong>{kpi.total}</strong>
                    <span>vehicles</span>
                  </div>
                </div>
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
              {mixDominant && mixDominant.n > 0 ? (
                <div className={`fleet-cc-util-callout is-${mixDominant.cls}`}>
                  <IcoAttention />
                  <span>
                    {mixDominant.pct}% {LIVE_OPS_LABELS[mixDominant.cls].toLowerCase()}
                    {mixDominant.cls === "idle" || mixDominant.cls === "stale"
                      ? " — needs attention"
                      : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      </>
      ) : null}
        </div>
      </div>
    </div>
  );
}
