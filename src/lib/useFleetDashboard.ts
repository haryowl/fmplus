import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGroups, fetchUsersForGroup, loadTripsForUsers, userLabel } from "./api";
import { computeBehavior } from "./behavior";
import {
  DEFAULT_FUEL_PRICE,
  DEFAULT_HARSH_ACCEL,
  DEFAULT_HARSH_BRAKE,
  DEFAULT_HARSH_CORNER,
  DEFAULT_MIN_SPEED_KMH,
  DEFAULT_REFILL_THRESHOLD_L,
  DEFAULT_SPEED_LIMIT_KMH,
  DEFAULT_TRIP_BREAK_MIN,
  FLEET_VEHICLE_CAP,
} from "./config";
import { EMBED_READY, embedOriginAllowlist, parseHostMessage } from "./embed";
import { useEmbedTenant } from "./useEmbedTenant";
import {
  alignedPeriodKeys,
  buildFleetInsights,
  fleetColor,
  type FleetVehicleRow,
} from "./fleet";
import { defaultFleetUserIds, parseUserIdsSearch, writeFleetSelection } from "./lastUsed";
import { computePeriodMetrics, sumMetrics } from "./metrics";
import { addDays, todayKeyInOffset } from "./time";
import type { Group, LoadProgress, Period, Trip, User } from "./types";

export function useFleetDashboard() {
  const { query, ready, error: tenantError, allowedUserIds, allowedGroupIds, allowsUser, allowsGroup } =
    useEmbedTenant();
  const queryUserIds = useMemo(() => parseUserIdsSearch(window.location.search), []);
  const defaultTo = todayKeyInOffset(query.tz);
  const defaultFrom = addDays(defaultTo, -13);

  const [hostLock, setHostLock] = useState(query.lock);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [userIds, setUserIds] = useState<string[]>(() =>
    defaultFleetUserIds({
      groupId: query.groupId,
      queryUserIds,
      queryUserId: query.userId,
    }),
  );
  const [dateFrom, setDateFrom] = useState(query.from || defaultFrom);
  const [dateTo, setDateTo] = useState(query.to || defaultTo);
  const [timezone, setTimezone] = useState(query.tz);
  const [period, setPeriod] = useState<Period>(query.period);
  const [byUserId, setByUserId] = useState<Map<number, Trip[]> | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadWarning, setLoadWarning] = useState("");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoLoaded = useRef(false);
  const allowsUserRef = useRef(allowsUser);
  const allowsGroupRef = useRef(allowsGroup);
  allowsUserRef.current = allowsUser;
  allowsGroupRef.current = allowsGroup;

  const selectedGroup = groups.find((g) => String(g.id) === groupId);

  const vehicles: FleetVehicleRow[] = useMemo(() => {
    return userIds.map((id, index) => {
      const user = users.find((u) => String(u.id) === id);
      const trips = byUserId?.get(Number(id)) ?? [];
      const rows =
        byUserId && trips.length
          ? computePeriodMetrics(trips, {
              period,
              dateFrom,
              dateTo,
              timezone,
              minSpeedKmh: DEFAULT_MIN_SPEED_KMH,
              refillThresholdL: DEFAULT_REFILL_THRESHOLD_L,
              fuelPricePerL: DEFAULT_FUEL_PRICE,
              tripBreakMin: DEFAULT_TRIP_BREAK_MIN,
            })
          : [];
      const totals = sumMetrics(rows);
      const behavior =
        trips.length > 0
          ? computeBehavior(trips, {
              period,
              dateFrom,
              dateTo,
              timezone,
              distanceKm: totals.gps,
              thresholds: {
                harshBrake: DEFAULT_HARSH_BRAKE,
                harshAccel: DEFAULT_HARSH_ACCEL,
                harshCorner: DEFAULT_HARSH_CORNER,
                speedLimitKmh: DEFAULT_SPEED_LIMIT_KMH,
              },
            })
          : null;
      return {
        userId: Number(id),
        label: user ? userLabel(user) : `User ${id}`,
        color: fleetColor(index),
        rows,
        totals,
        behavior,
        hasData: rows.length > 0,
      };
    });
  }, [userIds, users, byUserId, period, dateFrom, dateTo, timezone]);

  const insights = useMemo(() => buildFleetInsights(vehicles), [vehicles]);
  const periods = useMemo(() => alignedPeriodKeys(vehicles), [vehicles]);
  const loadedCount = vehicles.filter((v) => v.hasData).length;
  const fleetGps = vehicles.reduce((sum, v) => sum + v.totals.gps, 0);
  const fleetFuel = vehicles.reduce((sum, v) => sum + v.totals.fuel, 0);
  const fleetHours = vehicles.reduce((sum, v) => sum + v.totals.hours, 0);
  const fleetIdle = vehicles.reduce((sum, v) => sum + v.totals.idle, 0);
  const fleetCost = vehicles.reduce((sum, v) => sum + v.totals.cost, 0);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    setUserIds((prev) => {
      const kept = prev.filter((id) => allowsUser(id));
      if (allowedUserIds.length === 1) return [String(allowedUserIds[0])];
      return kept;
    });
    if (groupId && !allowsGroup(groupId)) {
      setGroupId(allowedGroupIds.length === 1 ? String(allowedGroupIds[0]) : "");
      setHostLock((prev) => ({ ...prev, group: allowedGroupIds.length === 1 }));
    }
    if (allowedUserIds.length === 1) {
      setHostLock((prev) => ({ ...prev, user: true }));
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchGroups(ac.signal)
      .then((list) => {
        const next = allowedGroupIds.length ? list.filter((g) => allowsGroup(g.id)) : list;
        setGroups(next);
        setBootError("");
        if (!groupId && next.length === 1) setGroupId(String(next[0].id));
        if (allowedGroupIds.length === 1) {
          setGroupId(String(allowedGroupIds[0]));
          setHostLock((prev) => ({ ...prev, group: true }));
        }
        if (allowedUserIds.length === 1) {
          setUserIds([String(allowedUserIds[0])]);
          setHostLock((prev) => ({ ...prev, user: true }));
        }
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setBootError(
          err.message.includes("401") || err.message.includes("403")
            ? "Could not reach Armada. Auth is injected on the server (ARMADA_AUTH_HEADER), not in this page."
            : err.message,
        );
      });
    return () => ac.abort();
  }, [ready]);

  useEffect(() => {
    if (!selectedGroup) {
      setUsers([]);
      return;
    }
    const ac = new AbortController();
    fetchUsersForGroup(selectedGroup, ac.signal)
      .then((list) => {
        const next = allowedUserIds.length ? list.filter((u) => allowsUser(u.id)) : list;
        setUsers(next);
        const allowed = next.map((u) => String(u.id));
        setUserIds((prev) => {
          const kept = prev.filter((id) => allowed.includes(id));
          if (kept.length) {
            const next = kept.slice(0, FLEET_VEHICLE_CAP);
            if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
            return next;
          }
          return defaultFleetUserIds({
            groupId: String(selectedGroup.id),
            queryUserIds,
            queryUserId: query.userId,
            allowedIds: allowed,
          });
        });
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setLoadError(err.message);
      });
    return () => ac.abort();
  }, [selectedGroup?.id]);

  useEffect(() => {
    if (groupId) writeFleetSelection(groupId, userIds);
  }, [groupId, userIds]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (userIds.length) params.set("userIds", userIds.join(","));
    else params.delete("userIds");
    if (userIds[0]) params.set("userId", userIds[0]);
    if (groupId) params.set("groupId", groupId);
    const next = `${window.location.pathname}?${params.toString()}`;
    const current = `${window.location.pathname}${window.location.search}`;
    if (next !== current) window.history.replaceState(null, "", next);
  }, [groupId, userIds]);

  async function handleLoad() {
    const ids = userIds
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0 && allowsUserRef.current(id));
    if (ids.length === 0) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setLoadError("");
    setLoadWarning("");
    setByUserId(null);
    setProgress({ phase: "trips", loaded: 0, total: 1 });
    try {
      const result = await loadTripsForUsers({
        userIds: ids,
        dateFrom,
        dateTo,
        timezone,
        signal: ac.signal,
        onProgress: setProgress,
      });
      setByUserId(result.byUserId);
      if (result.skipped > 0) {
        setLoadWarning(
          `${result.skipped} Armada request${result.skipped === 1 ? "" : "s"} skipped after rate limits. Reload to fill gaps.`,
        );
      }
      const anyTrips = [...result.byUserId.values()].some((trips) => trips.length > 0);
      if (!anyTrips) {
        setLoadError("No trips found for the selected vehicles in this range.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setLoadError((err as Error).message || "Failed to load trips.");
        setByUserId(null);
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  const handleLoadRef = useRef(handleLoad);
  handleLoadRef.current = handleLoad;

  useEffect(() => {
    if (autoLoaded.current) return;
    if (!ready || userIds.length === 0) return;
    if (!userIds.some((id) => allowsUserRef.current(id))) return;
    autoLoaded.current = true;
    void handleLoadRef.current();
  }, [ready, userIds]);

  useEffect(() => {
    const allowlist = embedOriginAllowlist();
    if (window.parent !== window) {
      window.parent.postMessage({ type: EMBED_READY }, "*");
    }
    const onMessage = (event: MessageEvent) => {
      const cfg = parseHostMessage(event.data, event.origin, allowlist, window.location.origin);
      if (!cfg) return;
      if (cfg.groupId && allowsGroupRef.current(cfg.groupId)) setGroupId(cfg.groupId);
      if (cfg.userId && allowsUserRef.current(cfg.userId)) setUserIds([cfg.userId]);
      if (cfg.from) setDateFrom(cfg.from);
      if (cfg.to) setDateTo(cfg.to);
      if (cfg.tz) setTimezone(cfg.tz);
      setPeriod(cfg.period);
      setHostLock((prev) => ({
        group: prev.group || cfg.lock.group,
        user: prev.user || cfg.lock.user,
        from: prev.from || cfg.lock.from,
        to: prev.to || cfg.lock.to,
        tz: prev.tz || cfg.lock.tz,
      }));
      setByUserId(null);
      if (cfg.userId) {
        autoLoaded.current = false;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const progressPct =
    progress?.phase === "charts"
      ? 100
      : progress && progress.total > 0
        ? Math.round((progress.loaded / progress.total) * 100)
        : 8;

  function changeGroup(next: string) {
    setGroupId(next);
    setUserIds([]);
    setByUserId(null);
    autoLoaded.current = false;
  }

  function changeUserIds(next: string[]) {
    setUserIds(next.filter((id) => allowsUserRef.current(id)).slice(0, FLEET_VEHICLE_CAP));
    setByUserId(null);
  }

  return {
    query,
    hostLock,
    groups,
    users,
    groupId,
    changeGroup,
    userIds,
    changeUserIds,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    timezone,
    setTimezone,
    period,
    setPeriod,
    loading,
    bootError,
    loadError,
    loadWarning,
    progress,
    progressPct,
    selectedGroup,
    vehicles,
    insights,
    periods,
    loadedCount,
    fleetGps,
    fleetFuel,
    fleetHours,
    fleetIdle,
    fleetCost,
    byUserId,
    handleLoad,
  };
}
