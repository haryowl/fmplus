import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGroups, fetchUsersForGroup, loadTripsForUser } from "./api";
import {
  DEFAULT_FUEL_PRICE,
  DEFAULT_HARSH_ACCEL,
  DEFAULT_HARSH_BRAKE,
  DEFAULT_HARSH_CORNER,
  DEFAULT_MIN_SPEED_KMH,
  DEFAULT_REFILL_THRESHOLD_L,
  DEFAULT_SPEED_LIMIT_KMH,
  DEFAULT_TRIP_BREAK_MIN,
} from "./config";
import { computeBehavior } from "./behavior";
import { computePeriodMetrics, sumMetrics } from "./metrics";
import type { InsightInput } from "./insight";
import { addDays, todayKeyInOffset } from "./time";
import type { Group, LoadProgress, Period, Trip, User } from "./types";
import {
  EMBED_READY,
  allowedOrigins,
  parseEmbedSearch,
  parseHostMessage,
  type EmbedConfig,
} from "./embed";
import { writeLastVehicle } from "./lastUsed";

export function useVehicleDashboard() {
  const query = useMemo(() => parseEmbedSearch(window.location.search), []);
  const defaultTo = todayKeyInOffset(query.tz);
  const defaultFrom = addDays(defaultTo, -13);

  const [compact, setCompact] = useState(query.compact);
  const [hostLock, setHostLock] = useState(query.lock);

  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [userId, setUserId] = useState(query.userId);
  const [dateFrom, setDateFrom] = useState(query.from || defaultFrom);
  const [dateTo, setDateTo] = useState(query.to || defaultTo);
  const [timezone, setTimezone] = useState(query.tz);
  const [period, setPeriod] = useState<Period>(query.period);
  const [minSpeed, setMinSpeed] = useState(DEFAULT_MIN_SPEED_KMH);
  const [tripBreakMin, setTripBreakMin] = useState(DEFAULT_TRIP_BREAK_MIN);
  const [fuelPrice, setFuelPrice] = useState(DEFAULT_FUEL_PRICE);
  const [refillThreshold, setRefillThreshold] = useState(DEFAULT_REFILL_THRESHOLD_L);
  const [harshBrake, setHarshBrake] = useState(DEFAULT_HARSH_BRAKE);
  const [harshAccel, setHarshAccel] = useState(DEFAULT_HARSH_ACCEL);
  const [harshCorner, setHarshCorner] = useState(DEFAULT_HARSH_CORNER);
  const [speedLimit, setSpeedLimit] = useState(DEFAULT_SPEED_LIMIT_KMH);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootError, setBootError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadWarning, setLoadWarning] = useState("");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoLoaded = useRef(false);

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const selectedUser = users.find((u) => String(u.id) === userId);

  useEffect(() => {
    if (groupId && userId) writeLastVehicle(groupId, userId);
  }, [groupId, userId]);

  const rows = useMemo(() => {
    if (!trips) return [];
    return computePeriodMetrics(trips, {
      period,
      dateFrom,
      dateTo,
      timezone,
      minSpeedKmh: minSpeed,
      refillThresholdL: refillThreshold,
      fuelPricePerL: fuelPrice,
      tripBreakMin,
    });
  }, [trips, period, dateFrom, dateTo, timezone, minSpeed, refillThreshold, fuelPrice, tripBreakMin]);

  const totals = useMemo(() => sumMetrics(rows), [rows]);

  const behavior = useMemo(() => {
    if (!trips) return null;
    return computeBehavior(trips, {
      period,
      dateFrom,
      dateTo,
      timezone,
      distanceKm: totals.gps,
      thresholds: {
        harshBrake,
        harshAccel,
        harshCorner,
        speedLimitKmh: speedLimit,
      },
    });
  }, [trips, period, dateFrom, dateTo, timezone, totals.gps, harshBrake, harshAccel, harshCorner, speedLimit]);

  const insightInput = useMemo((): InsightInput | null => {
    if (rows.length === 0) return null;
    return {
      gpsKm: totals.gps,
      activeHours: totals.hours,
      idleHours: totals.idle,
      avgSpeedKmh: totals.avgSpeed,
      avgRpm: totals.avgRpm,
      maxRpm: totals.maxRpm,
      fuelUsedL: totals.fuel,
      canFuelUsedL: totals.canFuel,
      tankFuelUsedL: totals.tankFuel,
      kmPerL: totals.fuel > 0 ? totals.gps / totals.fuel : 0,
      flatKmPerL: totals.flatKmPerL,
      terrainImpactPct: totals.terrainImpactPct,
      elevationGainM: totals.elevationGainM,
      elevationLossM: totals.elevationLossM,
      altitudeSamples: totals.altitudeSamples,
      roadSamples: totals.roadSamples,
      roadSmoothPct: totals.roadSmoothPct,
      roadRoughPct: totals.roadRoughPct,
      roadBumpyPct: totals.roadBumpyPct,
      avgVibrationMg: totals.avgVibrationMg,
      behavior,
    };
  }, [rows.length, totals, behavior]);

  useEffect(() => {
    const ac = new AbortController();
    fetchGroups(ac.signal)
      .then((list) => {
        setGroups(list);
        setBootError("");
        if (!groupId && list.length === 1) setGroupId(String(list[0].id));
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
  }, []);

  useEffect(() => {
    if (!selectedGroup) {
      setUsers([]);
      return;
    }
    const ac = new AbortController();
    fetchUsersForGroup(selectedGroup, ac.signal)
      .then((list) => {
        setUsers(list);
        if (userId && !list.some((u) => String(u.id) === userId)) {
          setUserId("");
        }
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setLoadError(err.message);
      });
    return () => ac.abort();
  }, [selectedGroup?.id]);

  async function handleLoad(override?: {
    userId?: string;
    dateFrom?: string;
    dateTo?: string;
    timezone?: string;
  }) {
    const uid = override?.userId ?? userId;
    const from = override?.dateFrom ?? dateFrom;
    const to = override?.dateTo ?? dateTo;
    const tz = override?.timezone ?? timezone;
    if (!uid) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setLoadError("");
    setLoadWarning("");
    setProgress({ phase: "trips", loaded: 0, total: 1 });
    try {
      const result = await loadTripsForUser({
        userId: Number(uid),
        dateFrom: from,
        dateTo: to,
        timezone: tz,
        signal: ac.signal,
        onProgress: setProgress,
      });
      setTrips(result.trips);
      if (result.skipped > 0) {
        setLoadWarning(
          `${result.skipped} trip${result.skipped === 1 ? "" : "s"} skipped after Armada rate limits. Reload to fill gaps.`,
        );
      }
      if (result.trips.length === 0) {
        setLoadError("No trips found for this vehicle in the selected range.");
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setLoadError((err as Error).message || "Failed to load trips.");
        setTrips(null);
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
    if (!query.userId || !userId) return;
    autoLoaded.current = true;
    void handleLoadRef.current();
  }, [query.userId, userId]);

  function applyHostConfig(cfg: EmbedConfig) {
    if (cfg.groupId) setGroupId(cfg.groupId);
    if (cfg.userId) setUserId(cfg.userId);
    if (cfg.from) setDateFrom(cfg.from);
    if (cfg.to) setDateTo(cfg.to);
    if (cfg.tz) setTimezone(cfg.tz);
    setPeriod(cfg.period);
    setCompact(cfg.compact);
    setHostLock((prev) => ({
      group: prev.group || cfg.lock.group,
      user: prev.user || cfg.lock.user,
      from: prev.from || cfg.lock.from,
      to: prev.to || cfg.lock.to,
      tz: prev.tz || cfg.lock.tz,
    }));
    setTrips(null);
  }

  useEffect(() => {
    const allowlist = allowedOrigins(import.meta.env.VITE_EMBED_ORIGINS);
    if (window.parent !== window) {
      window.parent.postMessage({ type: EMBED_READY }, "*");
    }
    const onMessage = (event: MessageEvent) => {
      const cfg = parseHostMessage(event.data, event.origin, allowlist, window.location.origin);
      if (!cfg) return;
      applyHostConfig(cfg);
      if (cfg.userId) {
        void handleLoadRef.current({
          userId: cfg.userId,
          dateFrom: cfg.from || undefined,
          dateTo: cfg.to || undefined,
          timezone: cfg.tz,
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 8;

  return {
    query,
    compact,
    hostLock,
    groups,
    users,
    groupId,
    setGroupId,
    userId,
    setUserId,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    timezone,
    setTimezone,
    period,
    setPeriod,
    minSpeed,
    setMinSpeed,
    tripBreakMin,
    setTripBreakMin,
    fuelPrice,
    setFuelPrice,
    refillThreshold,
    setRefillThreshold,
    harshBrake,
    setHarshBrake,
    harshAccel,
    setHarshAccel,
    harshCorner,
    setHarshCorner,
    speedLimit,
    setSpeedLimit,
    trips,
    setTrips,
    loading,
    bootError,
    loadError,
    loadWarning,
    progress,
    progressPct,
    selectedGroup,
    selectedUser,
    rows,
    totals,
    behavior,
    insightInput,
    handleLoad,
  };
}
