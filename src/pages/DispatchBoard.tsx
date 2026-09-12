import { useEffect, useMemo, useState } from "react";
import { fetchGroups, fetchUsersForGroup, groupOptionLabel, userOptionLabel } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { DispatchJobMap } from "../components/DispatchJobMap";
import { ViewNav } from "../components/ViewNav";
import {
  assignOrdersToJob,
  cancelDispatchOrder,
  capacityForVehicle,
  createDispatchDepot,
  createDispatchJob,
  createDispatchOrder,
  deleteDispatchDepot,
  deleteDispatchOrder,
  DISPATCH_STATUS_LABELS,
  dispatchAssigneeLabel,
  dispatchVehicleLabel,
  fetchDispatchDepots,
  fetchDispatchFieldUsers,
  fetchDispatchJobs,
  fetchDispatchOrders,
  fetchStopPhotos,
  fetchVehicleCapacities,
  fetchDispatchDepot,
  formatDispatchWindow,
  formatDispatchServiceMinutes,
  formatServiceDateLabel,
  optimizeJobStops,
  patchDispatchDepot,
  patchDispatchJob,
  patchDispatchOrder,
  planDispatchDay,
  returnStopToInbox,
  saveDispatchDepot,
  shiftServiceDate,
  todayServiceDate,
  upsertVehicleCapacity,
  utilizationTone,
  withTenantQuery,
  type DispatchDepot,
  type DispatchFieldUser,
  type DispatchFleetMode,
  type DispatchDepotMode,
  type DispatchDepotPathMode,
  type DispatchOpenStartMode,
  type DispatchTwMode,
  type DispatchJob,
  type DispatchOrder,
  type DispatchPhoto,
  type DispatchPlanDayResult,
  type DispatchStatus,
  type VehicleCapacity,
} from "../lib/dispatch";
import {
  listPoiDropdownOptions,
  loadDispatchPoiCatalog,
  placeResultFromPoi,
  placeSearchSourceLabel,
  reverseAddress,
  searchDispatchPlaces,
  type PlaceSearchResult,
} from "../lib/geocode";
import type { ArmadaPoi } from "../lib/places";
import {
  buildStopRouteMeta,
  estimateStraightRoute,
  fetchRouteGeometry,
  formatRouteDuration,
  type RouteGeometryResult,
} from "../lib/routePlan";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";

const emptyOrderForm = {
  customerName: "",
  externalRef: "",
  address: "",
  zone: "",
  volumeM3: "",
  weightKg: "",
  windowStart: "08:00",
  windowEnd: "12:00",
  serviceMinutes: "",
  proofRequired: false,
  lat: null as number | null,
  lon: null as number | null,
};

const WINDOW_PRESETS: { id: string; label: string; start: string; end: string }[] = [
  { id: "morning", label: "Morning", start: "08:00", end: "12:00" },
  { id: "midday", label: "Midday", start: "11:00", end: "14:00" },
  { id: "afternoon", label: "Afternoon", start: "13:00", end: "17:00" },
  { id: "business", label: "Business day", start: "08:00", end: "17:00" },
  { id: "open", label: "Any time", start: "", end: "" },
];

function activeWindowPreset(start: string, end: string): string | null {
  const hit = WINDOW_PRESETS.find((p) => p.start === start && p.end === end);
  return hit?.id || null;
}

export default function DispatchBoard() {
  const { ready, error: tenantError, query, allowedUserIds, allowedGroupIds, allowsUser, allowsGroup } =
    useEmbedTenant();
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [fieldUsers, setFieldUsers] = useState<DispatchFieldUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [userId, setUserId] = useState(query.userId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bootError, setBootError] = useState("");
  const [reload, setReload] = useState(0);
  const [planDate, setPlanDate] = useState(todayServiceDate);
  const [showNewJob, setShowNewJob] = useState(false);
  const [proofStopId, setProofStopId] = useState<string | null>(null);
  const [proofPhotos, setProofPhotos] = useState<DispatchPhoto[]>([]);

  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [placeMode, setPlaceMode] = useState<"poi" | "search">("poi");
  const [poiCatalog, setPoiCatalog] = useState<ArmadaPoi[]>([]);
  const [poiCatalogReady, setPoiCatalogReady] = useState(false);
  const [poiFilter, setPoiFilter] = useState("");
  const [poiPickKey, setPoiPickKey] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  const [jobTitle, setJobTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [jobVolCap, setJobVolCap] = useState("12");
  const [jobWtCap, setJobWtCap] = useState("1500");
  const [vehicleCaps, setVehicleCaps] = useState<VehicleCapacity[]>([]);
  const [editVolCap, setEditVolCap] = useState("12");
  const [editWtCap, setEditWtCap] = useState("1500");
  const [showPlanDay, setShowPlanDay] = useState(false);
  const [fleetMode, setFleetMode] = useState<DispatchFleetMode>("both");
  const [depotMode, setDepotMode] = useState<DispatchDepotMode>("open");
  const [depotPathMode, setDepotPathMode] = useState<DispatchDepotPathMode>("sequence");
  const [openStartMode, setOpenStartMode] = useState<DispatchOpenStartMode>("none");
  const [depotLat, setDepotLat] = useState("");
  const [depotLon, setDepotLon] = useState("");
  const [depots, setDepots] = useState<DispatchDepot[]>([]);
  const [selectedDepotId, setSelectedDepotId] = useState("");
  const [newDepotName, setNewDepotName] = useState("");
  const [depotPoiFilter, setDepotPoiFilter] = useState("");
  const [depotPoiPickKey, setDepotPoiPickKey] = useState("");
  const [editDepotId, setEditDepotId] = useState("");
  const [planRoundtrip, setPlanRoundtrip] = useState(false);
  const [planTwMode, setPlanTwMode] = useState<DispatchTwMode>("soft");
  const [planServiceMin, setPlanServiceMin] = useState("8");
  const [planDayStart, setPlanDayStart] = useState("08:00");
  const [planMaxStops, setPlanMaxStops] = useState("");
  const [planOnlyEmpty, setPlanOnlyEmpty] = useState(false);
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [avoidMotorways, setAvoidMotorways] = useState(false);
  const [avoidFerries, setAvoidFerries] = useState(false);
  const [respectGanjilGenap, setRespectGanjilGenap] = useState(true);
  const [plateParity, setPlateParity] = useState<"odd" | "even" | "unknown" | "exempt">("unknown");
  const [editPlateParity, setEditPlateParity] = useState<"odd" | "even" | "unknown" | "exempt">("unknown");
  const [planPreview, setPlanPreview] = useState<DispatchPlanDayResult | null>(null);
  const [pinningDepot, setPinningDepot] = useState(false);
  const [jobRoute, setJobRoute] = useState<RouteGeometryResult | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const selectedUser = users.find((u) => String(u.id) === userId);
  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) || null, [jobs, selectedId]);
  const draftPin =
    orderForm.lat != null && orderForm.lon != null
      ? { lat: orderForm.lat, lon: orderForm.lon }
      : null;
  const depotPin = useMemo(() => {
    const lat = Number(depotLat);
    const lon = Number(depotLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }, [depotLat, depotLon]);
  const selectedDepot = useMemo(
    () => depots.find((d) => d.id === selectedDepotId) || null,
    [depots, selectedDepotId],
  );
  const mapDraftPin =
    showPlanDay &&
    ((depotMode === "depot" && (pinningDepot || depotPin)) ||
      (depotMode === "multi" && (pinningDepot || selectedDepot)))
      ? depotMode === "multi" && selectedDepot
        ? { lat: selectedDepot.lat, lon: selectedDepot.lon }
        : depotPin
      : draftPin;
  const fitKey = selected
    ? `${selected.id}-${selected.stops.map((s) => s.id).join(",")}-${mapDraftPin ? "pin" : ""}-${jobRoute?.geometry?.length || 0}`
    : `empty-${mapDraftPin ? `${mapDraftPin.lat},${mapDraftPin.lon}` : ""}`;

  const stopRouteMeta = useMemo(() => {
    if (!selected?.stops?.length) return [];
    return buildStopRouteMeta(selected.stops, jobRoute?.legs || [], Number(planServiceMin) || 8);
  }, [selected, jobRoute, planServiceMin]);

  const poiOptions = useMemo(
    () => listPoiDropdownOptions(poiCatalog, poiFilter),
    [poiCatalog, poiFilter],
  );
  const depotPoiOptions = useMemo(
    () => listPoiDropdownOptions(poiCatalog, depotPoiFilter),
    [poiCatalog, depotPoiFilter],
  );

  const routePathKey = useMemo(() => {
    if (!selected) return "";
    return selected.stops
      .filter((s) => s.lat != null && s.lon != null)
      .map((s) => `${s.id}:${s.lat},${s.lon}`)
      .join("|");
  }, [selected]);

  const kpis = useMemo(() => {
    const openOrders = orders.length;
    const openJobs = jobs.filter((j) => j.status !== "done" && j.status !== "cancelled").length;
    const utilJobs = jobs.filter(
      (j) => j.status !== "done" && j.status !== "cancelled" && (j.stops?.length || 0) > 0,
    );
    const avgUtil =
      utilJobs.length === 0
        ? 0
        : Math.round(
            (utilJobs.reduce((s, j) => s + (j.utilizationPct || 0), 0) / utilJobs.length) * 10,
          ) / 10;
    return { openOrders, openJobs, avgUtil };
  }, [orders, jobs]);

  useEffect(() => {
    document.title = "Dispatch · FM Plus";
  }, []);

  useEffect(() => {
    if (tenantError) setBootError(tenantError);
  }, [tenantError]);

  useEffect(() => {
    if (!ready) return;
    const ac = new AbortController();
    fetchGroups(ac.signal)
      .then((list) => {
        const next = allowedGroupIds.length ? list.filter((g) => allowsGroup(g.id)) : list;
        setGroups(next);
        if (!groupId && next.length === 1) setGroupId(String(next[0].id));
        if (allowedGroupIds.length === 1) setGroupId(String(allowedGroupIds[0]));
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setBootError(err.message);
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
        setUsers(allowedUserIds.length ? list.filter((u) => allowsUser(u.id)) : list);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [selectedGroup?.id]);

  useEffect(() => {
    if (!ready || !query.tenantKey) return;
    let cancelled = false;
    Promise.all([fetchDispatchFieldUsers(), fetchVehicleCapacities()])
      .then(([list, caps]) => {
        if (cancelled) return;
        setFieldUsers(list);
        setVehicleCaps(caps);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, query.tenantKey, reload]);

  useEffect(() => {
    const id = userId ? Number(userId) : null;
    const cap = capacityForVehicle(vehicleCaps, id);
    setJobVolCap(String(cap.volumeCapacityM3));
    setJobWtCap(String(cap.weightCapacityKg));
  }, [userId, vehicleCaps]);

  useEffect(() => {
    if (!selected) return;
    setEditVolCap(String(selected.volumeCapacityM3 ?? 12));
    setEditWtCap(String(selected.weightCapacityKg ?? 1500));
    const cap = vehicleCaps.find((c) => c.armadaUserId === selected.armadaUserId);
    setEditDepotId(cap?.depotId || "");
    setEditPlateParity((cap?.plateParity as typeof editPlateParity) || "unknown");
  }, [selected?.id, selected?.volumeCapacityM3, selected?.weightCapacityKg, selected?.armadaUserId, vehicleCaps]);

  useEffect(() => {
    if (!ready) return;
    if (!query.tenantKey) {
      setError("Open with k= (tenant key) to load dispatch.");
      setJobs([]);
      setOrders([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      fetchDispatchJobs("open", ac.signal, planDate),
      fetchDispatchOrders("pending", ac.signal, planDate),
    ])
      .then(([jobList, orderList]) => {
        setJobs(jobList);
        setOrders(orderList);
        setBootError("");
        if (selectedId && !jobList.some((j) => j.id === selectedId)) setSelectedId(null);
        if (!selectedId && jobList[0]) setSelectedId(jobList[0].id);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setJobs([]);
        setOrders([]);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [ready, query.tenantKey, reload, planDate]);

  useEffect(() => {
    if (!proofStopId || !query.tenantKey) {
      setProofPhotos([]);
      return;
    }
    let cancelled = false;
    fetchStopPhotos(proofStopId)
      .then((photos) => {
        if (!cancelled) setProofPhotos(photos);
      })
      .catch(() => {
        if (!cancelled) setProofPhotos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [proofStopId, query.tenantKey, reload]);

  useEffect(() => {
    if (!selected || !routePathKey) {
      setJobRoute(null);
      return;
    }
    const customers = selected.stops
      .map((s) => ({ lat: Number(s.lat), lon: Number(s.lon) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
    const mode = selected.routeAnchorMode;
    const start =
      mode === "map" || mode === "sequence"
        ? selected.routeStart && Number.isFinite(selected.routeStart.lat)
          ? { lat: selected.routeStart.lat, lon: selected.routeStart.lon }
          : null
        : null;
    const end =
      mode === "map" || mode === "sequence"
        ? selected.routeEnd && Number.isFinite(selected.routeEnd.lat)
          ? { lat: selected.routeEnd.lat, lon: selected.routeEnd.lon }
          : null
        : null;
    const points = [...(start ? [start] : []), ...customers, ...(end ? [end] : [])];
    if (points.length < 2) {
      setJobRoute(null);
      return;
    }
    const ac = new AbortController();
    setRouteBusy(true);
    fetchRouteGeometry(points, ac.signal, {
      avoidTolls,
      avoidMotorways,
      avoidFerries,
      respectGanjilGenap,
      plateParity,
    })
      .then((route) => {
        const geomLen = route.geometry?.length || 0;
        const hasPath = geomLen >= 2;
        const hasDist = (route.distanceKm || 0) > 0;
        // Keep OSRM (or any) result that has a real path; only invent straight-line if empty.
        if (hasPath && (hasDist || geomLen > points.length)) {
          setJobRoute(route);
          return;
        }
        if (hasPath && hasDist) {
          setJobRoute(route);
          return;
        }
        const estimated = estimateStraightRoute(points);
        setJobRoute({
          ...estimated,
          warning: route.warning || estimated.warning,
        });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setJobRoute(estimateStraightRoute(points));
      })
      .finally(() => setRouteBusy(false));
    return () => ac.abort();
  }, [selected, routePathKey, avoidTolls, avoidMotorways, avoidFerries, respectGanjilGenap, plateParity]);

  useEffect(() => {
    if (!ready || !query.tenantKey) return;
    const ac = new AbortController();
    setPoiCatalogReady(false);
    loadDispatchPoiCatalog(ac.signal)
      .then((pois) => {
        setPoiCatalog(pois);
        setPoiCatalogReady(true);
      })
      .catch(() => {
        setPoiCatalog([]);
        setPoiCatalogReady(true);
      });
    return () => ac.abort();
  }, [ready, query.tenantKey]);

  useEffect(() => {
    if (placeMode !== "search") {
      setSearchResults([]);
      return;
    }
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setSearchBusy(true);
      searchDispatchPlaces(q, ac.signal)
        .then((results) => setSearchResults(results))
        .catch((err: Error) => {
          if (err.name !== "AbortError") setSearchResults([]);
        })
        .finally(() => setSearchBusy(false));
    }, 320);
    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [searchQ, placeMode]);

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function applyPin(result: PlaceSearchResult) {
    setOrderForm((f) => ({
      ...f,
      address: result.label,
      lat: result.lat,
      lon: result.lon,
      customerName: f.customerName || result.customerHint || shortCustomerFromLabel(result.label),
      zone: f.zone || result.zoneHint || "",
    }));
    setPlacing(true);
    setSearchQ("");
    setSearchResults([]);
    setPoiPickKey("");
    setError("");
  }

  function applyPoiKey(key: string) {
    setPoiPickKey(key);
    if (!key) return;
    const poi = poiCatalog.find((p) => placeResultFromPoi(p)?.key === key);
    if (!poi) return;
    const result = placeResultFromPoi(poi);
    if (result) applyPin(result);
  }

  async function applyDepotPoiKey(key: string) {
    setDepotPoiPickKey(key);
    if (!key) return;
    const poi = poiCatalog.find((p) => placeResultFromPoi(p)?.key === key);
    if (!poi) return;
    const result = placeResultFromPoi(poi);
    if (!result) return;
    const lat = result.lat;
    const lon = result.lon;
    const poiName = (poi.name || "").trim() || result.label;
    setPinningDepot(false);
    setError("");

    if (depotMode === "depot") {
      persistDepot(lat, lon);
      return;
    }

    if (depotMode !== "multi") return;
    setBusy(true);
    try {
      if (selectedDepotId) {
        const updated = await patchDispatchDepot(selectedDepotId, { lat, lon });
        setDepots((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        if (updated.isDefault) {
          setDepotLat(String(lat));
          setDepotLon(String(lon));
        }
      } else {
        const created = await createDispatchDepot({
          name: newDepotName.trim() || poiName || `Depot ${depots.length + 1}`,
          lat,
          lon,
          isDefault: depots.length === 0,
        });
        setDepots((prev) => [...prev, created]);
        setSelectedDepotId(created.id);
        setNewDepotName("");
        if (created.isDefault) {
          setDepotLat(String(lat));
          setDepotLon(String(lon));
        }
      }
      setDepotPoiPickKey("");
      setDepotPoiFilter("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save depot from POI failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!ready || !query.tenantKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchDispatchDepots();
        if (cancelled) return;
        setDepots(list);
        const def = list.find((d) => d.isDefault) || list[0];
        if (def) {
          setSelectedDepotId(def.id);
          setDepotLat(String(def.lat));
          setDepotLon(String(def.lon));
        }
      } catch {
        try {
          const depot = await fetchDispatchDepot();
          if (cancelled || !depot) return;
          setDepotLat(String(depot.lat));
          setDepotLon(String(depot.lon));
        } catch {
          try {
            const raw = localStorage.getItem(`fmplus.dispatch.depot.${query.tenantKey}`);
            if (!raw || cancelled) return;
            const parsed = JSON.parse(raw) as { lat?: number; lon?: number };
            if (Number.isFinite(Number(parsed.lat)) && Number.isFinite(Number(parsed.lon))) {
              setDepotLat(String(parsed.lat));
              setDepotLon(String(parsed.lon));
            }
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, query.tenantKey]);

  function persistDepot(lat: number, lon: number) {
    setDepotLat(String(lat));
    setDepotLon(String(lon));
    if (query.tenantKey) {
      try {
        localStorage.setItem(
          `fmplus.dispatch.depot.${query.tenantKey}`,
          JSON.stringify({ lat, lon }),
        );
      } catch {
        /* ignore */
      }
    }
    void saveDispatchDepot({ lat, lon })
      .then(() => fetchDispatchDepots().then((list) => setDepots(list)))
      .catch(() => {
        /* migration may not be applied yet */
      });
  }

  async function clearPersistedDepot() {
    setDepotLat("");
    setDepotLon("");
    if (query.tenantKey) {
      try {
        localStorage.removeItem(`fmplus.dispatch.depot.${query.tenantKey}`);
      } catch {
        /* ignore */
      }
    }
    try {
      await saveDispatchDepot(null);
    } catch {
      /* ignore */
    }
  }

  async function refreshDepots() {
    const list = await fetchDispatchDepots();
    setDepots(list);
    if (selectedDepotId && !list.some((d) => d.id === selectedDepotId)) {
      const def = list.find((d) => d.isDefault) || list[0];
      setSelectedDepotId(def?.id || "");
    }
    return list;
  }

  async function onMapClick(lat: number, lon: number) {
    if (showPlanDay && depotMode === "depot" && pinningDepot) {
      persistDepot(lat, lon);
      setPinningDepot(false);
      setError("");
      return;
    }
    if (showPlanDay && depotMode === "multi" && pinningDepot) {
      setBusy(true);
      setError("");
      try {
        if (selectedDepotId) {
          const updated = await patchDispatchDepot(selectedDepotId, { lat, lon });
          setDepots((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          if (updated.isDefault) {
            setDepotLat(String(lat));
            setDepotLon(String(lon));
          }
        } else {
          const created = await createDispatchDepot({
            name: newDepotName.trim() || `Depot ${depots.length + 1}`,
            lat,
            lon,
            isDefault: depots.length === 0,
          });
          setDepots((prev) => [...prev, created]);
          setSelectedDepotId(created.id);
          setNewDepotName("");
          if (created.isDefault) {
            setDepotLat(String(lat));
            setDepotLon(String(lon));
          }
        }
        setPinningDepot(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save depot failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    setPinBusy(true);
    setError("");
    setPlacing(true);
    setOrderForm((f) => ({ ...f, lat, lon }));
    try {
      const result = await reverseAddress(lat, lon);
      setOrderForm((f) => ({
        ...f,
        lat: result.lat,
        lon: result.lon,
        address: result.label,
        customerName: f.customerName || shortCustomerFromLabel(result.label),
      }));
    } catch (err) {
      setOrderForm((f) => ({
        ...f,
        address: f.address || `Pin ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      }));
      setError(err instanceof Error ? err.message : "Could not resolve address");
    } finally {
      setPinBusy(false);
    }
  }

  function clearDraft() {
    setOrderForm(emptyOrderForm);
    setEditingOrderId(null);
    setPlacing(false);
    setSearchQ("");
    setSearchResults([]);
  }

  function startEditOrder(o: DispatchOrder) {
    setEditingOrderId(o.id);
    setPlacing(true);
    setOrderForm({
      customerName: o.customerName || "",
      externalRef: o.externalRef || "",
      address: o.address || "",
      zone: o.zone || "",
      volumeM3: o.volumeM3 != null ? String(o.volumeM3) : "",
      weightKg: o.weightKg != null ? String(o.weightKg) : "",
      windowStart: o.windowStart || "",
      windowEnd: o.windowEnd || "",
      serviceMinutes: o.serviceMinutes != null ? String(o.serviceMinutes) : "",
      proofRequired: o.proofRequired === true,
      lat: o.lat,
      lon: o.lon,
    });
    setSearchQ("");
    setSearchResults([]);
    setError("");
    setSelectedOrderIds((prev) => prev.filter((id) => id !== o.id));
  }

  async function handleSaveOrder() {
    if (!orderForm.customerName.trim()) {
      setError("Customer name required");
      return;
    }
    if (orderForm.lat == null || orderForm.lon == null) {
      setError("Pin a location on the map or pick an address search result");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      customerName: orderForm.customerName.trim(),
      externalRef: orderForm.externalRef.trim() || undefined,
      address: orderForm.address.trim() || undefined,
      zone: orderForm.zone.trim() || undefined,
      volumeM3: orderForm.volumeM3 === "" ? null : Number(orderForm.volumeM3),
      weightKg: orderForm.weightKg === "" ? null : Number(orderForm.weightKg),
      windowStart: orderForm.windowStart.trim() || undefined,
      windowEnd: orderForm.windowEnd.trim() || undefined,
      serviceMinutes:
        orderForm.serviceMinutes.trim() === ""
          ? null
          : Number(orderForm.serviceMinutes),
      proofRequired: orderForm.proofRequired,
      serviceDate: planDate,
      lat: orderForm.lat,
      lon: orderForm.lon,
    };
    try {
      if (editingOrderId) {
        await patchDispatchOrder(editingOrderId, payload);
      } else {
        await createDispatchOrder(payload);
      }
      clearDraft();
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : editingOrderId ? "Update order failed" : "Create order failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelOrder(o: DispatchOrder) {
    if (!window.confirm(`Cancel order “${o.customerName || o.externalRef || "order"}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await cancelDispatchOrder(o.id);
      if (editingOrderId === o.id) clearDraft();
      setSelectedOrderIds((prev) => prev.filter((id) => id !== o.id));
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel order failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOrder(o: DispatchOrder) {
    if (!window.confirm(`Delete order “${o.customerName || o.externalRef || "order"}” permanently?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteDispatchOrder(o.id);
      if (editingOrderId === o.id) clearDraft();
      setSelectedOrderIds((prev) => prev.filter((id) => id !== o.id));
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete order failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateJob() {
    if (!jobTitle.trim()) {
      setError("Job title required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const vol = Number(jobVolCap);
      const wt = Number(jobWtCap);
      const job = await createDispatchJob({
        title: jobTitle.trim(),
        serviceDate: planDate,
        assignedFieldUserId: assigneeId || null,
        armadaUserId: selectedUser ? Number(selectedUser.id) : null,
        armadaUsername: selectedUser?.username || "",
        userDisplayName: selectedUser ? userOptionLabel(selectedUser) : "",
        volumeCapacityM3: Number.isFinite(vol) && vol > 0 ? vol : null,
        weightCapacityKg: Number.isFinite(wt) && wt > 0 ? wt : null,
      });
      setJobTitle("");
      setShowNewJob(false);
      setSelectedId(job.id);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create job failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyJobCapacity() {
    if (!selected) return;
    const vol = Number(editVolCap);
    const wt = Number(editWtCap);
    if (!(vol > 0) || !(wt > 0)) {
      setError("Capacity must be greater than 0");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const job = await patchDispatchJob(selected.id, {
        volumeCapacityM3: vol,
        weightCapacityKg: wt,
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update capacity failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveVehicleDefault() {
    if (!selected?.armadaUserId) {
      setError("Assign an Armada vehicle on the job before saving a vehicle default");
      return;
    }
    const vol = Number(editVolCap);
    const wt = Number(editWtCap);
    if (!(vol > 0) || !(wt > 0)) {
      setError("Capacity must be greater than 0");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const job = await patchDispatchJob(selected.id, {
        volumeCapacityM3: vol,
        weightCapacityKg: wt,
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      const saved = await upsertVehicleCapacity({
        armadaUserId: selected.armadaUserId,
        volumeCapacityM3: vol,
        weightCapacityKg: wt,
        label: dispatchVehicleLabel(selected),
        depotId: editDepotId || null,
        plateParity: editPlateParity,
      });
      setVehicleCaps((prev) => {
        const rest = prev.filter((c) => c.armadaUserId !== saved.armadaUserId);
        return [...rest, saved].sort((a, b) => a.armadaUserId - b.armadaUserId);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save vehicle capacity failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssignSelected() {
    if (!selected || !selectedOrderIds.length) return;
    setBusy(true);
    setError("");
    try {
      const job = await assignOrdersToJob(selected.id, selectedOrderIds, {
        rejectOverCapacity: true,
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      setSelectedOrderIds([]);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function runPlanDay(apply: boolean) {
    setBusy(true);
    setError("");
    try {
      const dLat = depotLat.trim() ? Number(depotLat) : null;
      const dLon = depotLon.trim() ? Number(depotLon) : null;
      const plan = await planDispatchDay({
        serviceDate: planDate,
        fleetMode,
        depotMode,
        depotPathMode,
        openStartMode: depotMode === "open" ? openStartMode : "none",
        apply,
        roundtrip:
          depotMode === "depot" ||
          depotMode === "multi" ||
          (depotMode === "open" && openStartMode === "vehicle")
            ? planRoundtrip
            : false,
        depotLat: depotMode === "depot" ? dLat : null,
        depotLon: depotMode === "depot" ? dLon : null,
        persistDepot: depotMode === "depot" && dLat != null && dLon != null,
        twMode: planTwMode,
        serviceMinutes: Number(planServiceMin) || 8,
        dayStart: planDayStart || "08:00",
        maxStopsPerVehicle: planMaxStops.trim() ? Number(planMaxStops) : 0,
        onlyEmptyJobs: planOnlyEmpty,
        routing: {
          avoidTolls,
          avoidMotorways,
          avoidFerries,
          respectGanjilGenap,
          plateParity,
        },
      });
      setPlanPreview(plan);
      if (apply) {
        setShowPlanDay(false);
        setSelectedOrderIds([]);
        setReload((n) => n + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan day failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleOptimize() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const { job, route } = await optimizeJobStops(selected.id, {
        avoidTolls,
        avoidMotorways,
        avoidFerries,
        respectGanjilGenap,
        plateParity:
          plateParity !== "unknown"
            ? plateParity
            : (vehicleCaps.find((c) => c.armadaUserId === selected.armadaUserId)?.plateParity as
                | "odd"
                | "even"
                | "unknown"
                | "exempt"
                | undefined) || "unknown",
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      if (route && route.distanceKm && route.distanceKm > 0) {
        setJobRoute(route);
      } else {
        const pts = job.stops
          .map((s) => ({ lat: Number(s.lat), lon: Number(s.lon) }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
        if (pts.length >= 2) setJobRoute(estimateStraightRoute(pts));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimize failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleReturnStop(stopId: string, stopName: string) {
    if (!selected) return;
    if (
      !window.confirm(
        `Return “${stopName || "stop"}” to the inbox? It will leave this job and become unassigned again.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const job = await returnStopToInbox(selected.id, stopId);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      if (proofStopId === stopId) setProofStopId(null);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not return stop to inbox");
    } finally {
      setBusy(false);
    }
  }

  async function updateJob(id: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const job = await patchDispatchJob(id, patch);
      if (job.status === "cancelled" || job.status === "done") {
        setJobs((prev) => prev.filter((j) => j.id !== job.id));
        if (selectedId === id) setSelectedId(null);
        setReload((n) => n + 1);
      } else {
        setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelJob(job: DispatchJob) {
    const stopCount = job.stops?.length || 0;
    const msg =
      stopCount > 0
        ? `Cancel job “${job.title}”? Its ${stopCount} stop(s) will return to the inbox.`
        : `Cancel draft job “${job.title}”?`;
    if (!window.confirm(msg)) return;
    await updateJob(job.id, { status: "cancelled" });
  }

  const pinLabel = orderForm.address
    ? orderForm.address.length > 72
      ? `${orderForm.address.slice(0, 72)}…`
      : orderForm.address
    : "";

  return (
    <div className="app dispatch-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Dispatch</h1>
            <p>Plan by day · search or map · assign · field execution</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchDesk" />
          <div className="vehicle-chip">{loading ? "Loading…" : `${kpis.openJobs} jobs`}</div>
        </div>
      </header>

      <main className="shell dispatch-shell">
        <section className="dispatch-toolbar" aria-label="Dispatch overview">
          <div className="dispatch-date-nav" role="group" aria-label="Plan date">
            <button
              type="button"
              className="btn-secondary"
              aria-label="Previous day"
              onClick={() => {
                setSelectedId(null);
                setSelectedOrderIds([]);
                setPlanDate((d) => shiftServiceDate(d, -1));
              }}
            >
              ‹
            </button>
            <label className="dispatch-date-field">
              <span className="visually-hidden">Service date</span>
              <input
                type="date"
                value={planDate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                  setSelectedId(null);
                  setSelectedOrderIds([]);
                  setPlanDate(v);
                }}
              />
              <strong>{formatServiceDateLabel(planDate)}</strong>
            </label>
            <button
              type="button"
              className="btn-secondary"
              aria-label="Next day"
              onClick={() => {
                setSelectedId(null);
                setSelectedOrderIds([]);
                setPlanDate((d) => shiftServiceDate(d, 1));
              }}
            >
              ›
            </button>
            {planDate !== todayServiceDate() ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSelectedId(null);
                  setSelectedOrderIds([]);
                  setPlanDate(todayServiceDate());
                }}
              >
                Today
              </button>
            ) : null}
          </div>
          <div className="dispatch-kpi-strip">
            <div className="dispatch-kpi">
              <span>Unassigned</span>
              <strong>{kpis.openOrders}</strong>
            </div>
            <div className="dispatch-kpi">
              <span>Open jobs</span>
              <strong>{kpis.openJobs}</strong>
            </div>
            <div className="dispatch-kpi">
              <span>Avg fill</span>
              <strong className={`dispatch-util-${utilizationTone(kpis.avgUtil)}`}>{kpis.avgUtil}%</strong>
            </div>
          </div>
          <div className="dispatch-kpi-actions">
            <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowPlanDay((v) => !v);
                setPlanPreview(null);
                setPinningDepot(false);
                setShowNewJob(false);
              }}
            >
              {showPlanDay ? "Close plan" : "Auto-plan day"}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setShowNewJob((v) => !v)}>
              {showNewJob ? "Close" : "New job"}
            </button>
          </div>
        </section>

        {(bootError || error) && (
          <p className="dispatch-alert" role="alert">
            {error || bootError}
          </p>
        )}

        {showPlanDay && (
          <section className="dispatch-rail dispatch-create dispatch-plan-day">
            <header className="dispatch-pane-head">
              <p className="dispatch-eyebrow">CVRP · {formatServiceDateLabel(planDate)}</p>
              <h2>Auto-plan day</h2>
            </header>
            <div className="dispatch-create-grid">
              <div className="field">
                <label htmlFor="dispatch-fleet-mode">Fleet mode</label>
                <select
                  id="dispatch-fleet-mode"
                  value={fleetMode}
                  onChange={(e) => setFleetMode(e.target.value as DispatchFleetMode)}
                >
                  <option value="both">Open jobs + capacity presets</option>
                  <option value="jobs">Open jobs only</option>
                  <option value="presets">Capacity presets only (create jobs on apply)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="dispatch-depot-mode">Depot mode</label>
                <select
                  id="dispatch-depot-mode"
                  value={depotMode}
                  onChange={(e) => {
                    setDepotMode(e.target.value as DispatchDepotMode);
                    setPinningDepot(false);
                  }}
                >
                  <option value="open">Open tours (no depot)</option>
                  <option value="depot">From one depot</option>
                  <option value="multi">Multi-depot</option>
                </select>
              </div>
              {depotMode === "open" ? (
                <div className="field">
                  <label htmlFor="dispatch-open-start">Start point</label>
                  <select
                    id="dispatch-open-start"
                    value={openStartMode}
                    onChange={(e) => setOpenStartMode(e.target.value as DispatchOpenStartMode)}
                  >
                    <option value="none">None (open between stops)</option>
                    <option value="vehicle">Vehicle last position</option>
                  </select>
                </div>
              ) : null}
              {(depotMode === "depot" ||
                depotMode === "multi" ||
                (depotMode === "open" && openStartMode === "vehicle")) && (
                <div className="field">
                  <label htmlFor="dispatch-depot-path">Depot / start on route</label>
                  <select
                    id="dispatch-depot-path"
                    value={depotPathMode}
                    onChange={(e) => setDepotPathMode(e.target.value as DispatchDepotPathMode)}
                  >
                    <option value="calc">Calculation only</option>
                    <option value="map">Map (draw start/return)</option>
                    <option value="sequence">Sequence</option>
                  </select>
                </div>
              )}
              {depotMode === "open" && openStartMode === "vehicle" ? (
                <label className="dispatch-plan-check">
                  <input
                    type="checkbox"
                    checked={planRoundtrip}
                    onChange={(e) => setPlanRoundtrip(e.target.checked)}
                  />
                  Return to start (roundtrip)
                </label>
              ) : null}
              <div className="field">
                <label htmlFor="dispatch-tw-mode">Time windows</label>
                <select
                  id="dispatch-tw-mode"
                  value={planTwMode}
                  onChange={(e) => setPlanTwMode(e.target.value as DispatchTwMode)}
                >
                  <option value="soft">Soft (prefer on-time)</option>
                  <option value="hard">Hard (reject late)</option>
                  <option value="off">Ignore windows</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="dispatch-day-start">Day start</label>
                <input
                  id="dispatch-day-start"
                  type="time"
                  value={planDayStart}
                  onChange={(e) => setPlanDayStart(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="dispatch-service-min">Service min / stop (default)</label>
                <input
                  id="dispatch-service-min"
                  type="number"
                  min="0"
                  max="120"
                  value={planServiceMin}
                  onChange={(e) => setPlanServiceMin(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="dispatch-max-stops">Max stops / vehicle</label>
                <input
                  id="dispatch-max-stops"
                  type="number"
                  min="0"
                  placeholder="0 = no limit"
                  value={planMaxStops}
                  onChange={(e) => setPlanMaxStops(e.target.value)}
                />
              </div>
              <label className="dispatch-plan-check">
                <input
                  type="checkbox"
                  checked={planOnlyEmpty}
                  onChange={(e) => setPlanOnlyEmpty(e.target.checked)}
                />
                Only use empty open jobs
              </label>
              <div className="dispatch-routing-opts" style={{ gridColumn: "1 / -1" }}>
                <label className="dispatch-plan-check">
                  <input
                    type="checkbox"
                    checked={avoidTolls}
                    onChange={(e) => setAvoidTolls(e.target.checked)}
                  />
                  Avoid tolls
                </label>
                <label className="dispatch-plan-check">
                  <input
                    type="checkbox"
                    checked={avoidMotorways}
                    onChange={(e) => setAvoidMotorways(e.target.checked)}
                  />
                  Avoid motorways
                </label>
                <label className="dispatch-plan-check">
                  <input
                    type="checkbox"
                    checked={avoidFerries}
                    onChange={(e) => setAvoidFerries(e.target.checked)}
                  />
                  Avoid ferries
                </label>
                <label className="dispatch-plan-check">
                  <input
                    type="checkbox"
                    checked={respectGanjilGenap}
                    onChange={(e) => setRespectGanjilGenap(e.target.checked)}
                  />
                  Jakarta ganjil–genap
                </label>
              </div>
              {respectGanjilGenap ? (
                <div className="field">
                  <label htmlFor="dispatch-plate-parity">Plate parity (plan)</label>
                  <select
                    id="dispatch-plate-parity"
                    value={plateParity}
                    onChange={(e) => setPlateParity(e.target.value as typeof plateParity)}
                  >
                    <option value="unknown">From vehicles / unknown</option>
                    <option value="odd">Odd (ganjil)</option>
                    <option value="even">Even (genap)</option>
                    <option value="exempt">Exempt</option>
                  </select>
                </div>
              ) : null}
              {depotMode === "depot" ? (
                <>
                  <div className="field">
                    <label htmlFor="dispatch-depot-lat">Depot lat</label>
                    <input
                      id="dispatch-depot-lat"
                      value={depotLat}
                      onChange={(e) => setDepotLat(e.target.value)}
                      placeholder="-6.1754"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="dispatch-depot-lon">Depot lon</label>
                    <input
                      id="dispatch-depot-lon"
                      value={depotLon}
                      onChange={(e) => setDepotLon(e.target.value)}
                      placeholder="106.8272"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="dispatch-depot-poi-filter">Filter POIs</label>
                    <input
                      id="dispatch-depot-poi-filter"
                      value={depotPoiFilter}
                      onChange={(e) => setDepotPoiFilter(e.target.value)}
                      placeholder="Type to narrow…"
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="dispatch-depot-poi">Armada POI (depot)</label>
                    <select
                      id="dispatch-depot-poi"
                      value={depotPoiPickKey}
                      disabled={!poiCatalogReady || depotPoiOptions.length === 0 || busy}
                      onChange={(e) => void applyDepotPoiKey(e.target.value)}
                    >
                      <option value="">
                        {!poiCatalogReady
                          ? "Loading POIs…"
                          : poiCatalog.length === 0
                            ? "No POIs with coordinates"
                            : depotPoiOptions.length === 0
                              ? "No matches — clear filter"
                              : `Use POI as depot (${depotPoiOptions.length})`}
                      </option>
                      {depotPoiOptions.map((p) => {
                        const result = placeResultFromPoi(p);
                        if (!result) return null;
                        const cat = (p.categoryName || "").trim();
                        return (
                          <option key={result.key} value={result.key}>
                            {p.name}
                            {cat ? ` · ${cat}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="dispatch-create-actions" style={{ gridColumn: "1 / -1" }}>
                    <button
                      type="button"
                      className={`btn-secondary${pinningDepot ? " is-active" : ""}`}
                      onClick={() => setPinningDepot((v) => !v)}
                    >
                      {pinningDepot ? "Click the map…" : "Set depot on map"}
                    </button>
                    {depotPin ? (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void clearPersistedDepot()}
                      >
                        Clear depot
                      </button>
                    ) : null}
                  </div>
                  <label className="dispatch-plan-check">
                    <input
                      type="checkbox"
                      checked={planRoundtrip}
                      onChange={(e) => setPlanRoundtrip(e.target.checked)}
                    />
                    Return to depot (roundtrip)
                  </label>
                  <p className="dispatch-search-hint" style={{ gridColumn: "1 / -1" }}>
                    Pick an Armada POI, enter lat/lon, or click the map. Depot is remembered for this tenant.
                  </p>
                </>
              ) : null}
              {depotMode === "multi" ? (
                <>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="dispatch-depot-pick">Active depot</label>
                    <select
                      id="dispatch-depot-pick"
                      value={selectedDepotId}
                      onChange={(e) => {
                        setSelectedDepotId(e.target.value);
                        setDepotPoiPickKey("");
                      }}
                    >
                      <option value="">New depot (POI or map)</option>
                      {depots.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                          {d.isDefault ? " · default" : ""} · {d.lat.toFixed(4)}, {d.lon.toFixed(4)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {!selectedDepotId ? (
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor="dispatch-depot-name">New depot name</label>
                      <input
                        id="dispatch-depot-name"
                        value={newDepotName}
                        onChange={(e) => setNewDepotName(e.target.value)}
                        placeholder={`Depot ${depots.length + 1} (or use POI name)`}
                      />
                    </div>
                  ) : (
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor="dispatch-depot-rename">Rename depot</label>
                      <input
                        id="dispatch-depot-rename"
                        value={selectedDepot?.name || ""}
                        onChange={(e) => {
                          const name = e.target.value;
                          setDepots((prev) =>
                            prev.map((d) => (d.id === selectedDepotId ? { ...d, name } : d)),
                          );
                        }}
                        onBlur={() => {
                          if (!selectedDepotId || !selectedDepot) return;
                          void patchDispatchDepot(selectedDepotId, { name: selectedDepot.name }).catch(
                            (err) =>
                              setError(err instanceof Error ? err.message : "Rename depot failed"),
                          );
                        }}
                      />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="dispatch-multi-depot-poi-filter">Filter POIs</label>
                    <input
                      id="dispatch-multi-depot-poi-filter"
                      value={depotPoiFilter}
                      onChange={(e) => setDepotPoiFilter(e.target.value)}
                      placeholder="Type to narrow…"
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="dispatch-multi-depot-poi">Armada POI (depot)</label>
                    <select
                      id="dispatch-multi-depot-poi"
                      value={depotPoiPickKey}
                      disabled={!poiCatalogReady || depotPoiOptions.length === 0 || busy}
                      onChange={(e) => void applyDepotPoiKey(e.target.value)}
                    >
                      <option value="">
                        {!poiCatalogReady
                          ? "Loading POIs…"
                          : poiCatalog.length === 0
                            ? "No POIs with coordinates"
                            : depotPoiOptions.length === 0
                              ? "No matches — clear filter"
                              : selectedDepotId
                                ? `Move depot to POI (${depotPoiOptions.length})`
                                : `Create depot from POI (${depotPoiOptions.length})`}
                      </option>
                      {depotPoiOptions.map((p) => {
                        const result = placeResultFromPoi(p);
                        if (!result) return null;
                        const cat = (p.categoryName || "").trim();
                        return (
                          <option key={result.key} value={result.key}>
                            {p.name}
                            {cat ? ` · ${cat}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="dispatch-create-actions" style={{ gridColumn: "1 / -1" }}>
                    <button
                      type="button"
                      className={`btn-secondary${pinningDepot ? " is-active" : ""}`}
                      onClick={() => setPinningDepot((v) => !v)}
                    >
                      {pinningDepot
                        ? "Click the map…"
                        : selectedDepotId
                          ? "Move depot on map"
                          : "Pin new depot on map"}
                    </button>
                    {selectedDepotId ? (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy || selectedDepot?.isDefault}
                          onClick={() => {
                            void patchDispatchDepot(selectedDepotId, { isDefault: true })
                              .then((d) => {
                                setDepots((prev) =>
                                  prev.map((x) => ({
                                    ...x,
                                    isDefault: x.id === d.id,
                                    ...(x.id === d.id ? d : {}),
                                  })),
                                );
                                setDepotLat(String(d.lat));
                                setDepotLon(String(d.lon));
                              })
                              .catch((err) =>
                                setError(err instanceof Error ? err.message : "Set default failed"),
                              );
                          }}
                        >
                          Make default
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Delete depot “${selectedDepot?.name || ""}”?`)) return;
                            void deleteDispatchDepot(selectedDepotId)
                              .then(() => refreshDepots())
                              .catch((err) =>
                                setError(err instanceof Error ? err.message : "Delete depot failed"),
                              );
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                  <label className="dispatch-plan-check">
                    <input
                      type="checkbox"
                      checked={planRoundtrip}
                      onChange={(e) => setPlanRoundtrip(e.target.checked)}
                    />
                    Return to depot (roundtrip)
                  </label>
                  <p className="dispatch-search-hint" style={{ gridColumn: "1 / -1" }}>
                    Create or move a depot from an Armada POI, or pin on the map. Orders go to the nearest
                    depot. Vehicles use their capacity depot when set; otherwise they are balanced across
                    depots by demand. {depots.length} depot(s) saved.
                  </p>
                </>
              ) : null}
            </div>
            <p className="dispatch-search-hint">
              Packs pending orders onto vehicles under volume + weight caps using road distances when OSRM is up.
              Preview first, then apply.
            </p>
            <div className="dispatch-create-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void runPlanDay(false)}
              >
                Preview plan
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !planPreview}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Apply plan for ${formatServiceDateLabel(planDate)}? This assigns orders to jobs (and may create jobs from presets).`,
                    )
                  ) {
                    return;
                  }
                  void runPlanDay(true);
                }}
              >
                Apply plan
              </button>
            </div>
            {planPreview ? (
              <div className="dispatch-plan-preview">
                <p className="dispatch-eyebrow">
                  Preview · {planPreview.engine}
                  {planPreview.warning ? ` · ${planPreview.warning}` : ""}
                </p>
                <p className="dispatch-search-hint">
                  {planPreview.routes.length} route(s) · {planPreview.orderCount} orders considered ·{" "}
                  {planPreview.unassigned.length} unassigned
                  {planPreview.balanceMoves
                    ? ` · ${planPreview.balanceMoves} balance move(s)`
                    : ""}
                  {planPreview.depots?.length
                    ? ` · ${planPreview.depots.length} depot(s)`
                    : ""}
                </p>
                <ul className="dispatch-plan-routes">
                  {planPreview.routes.map((r) => (
                    <li key={r.key}>
                      <strong>
                        {r.label}
                        {r.depotName ? ` · ${r.depotName}` : ""}
                      </strong>
                      <span>
                        {r.orderIds.length} stops · {r.utilizationPct}% · {r.distanceKm} km · {r.volumeUsed}/
                        {r.volumeCapacityM3} m³ · {r.weightUsed}/{r.weightCapacityKg} kg
                        {r.lateStops ? ` · ${r.lateStops} late` : ""}
                      </span>
                      {r.stops && r.stops.length > 0 ? (
                        <ol className="dispatch-plan-stop-etas">
                          {r.pathMode === "sequence" && r.routeStart ? (
                            <li key={`${r.key}-start`}>
                              Start · {r.routeStart.label}
                            </li>
                          ) : null}
                          {r.stops.map((s, idx) => (
                            <li key={`${r.key}-${s.orderId || idx}`} className={s.late ? "is-late" : undefined}>
                              {s.arriveAt} · {s.label || s.orderId || `Stop ${idx + 1}`}
                              {s.serviceMinutes != null ? ` · ${s.serviceMinutes} min stop` : ""}
                              {s.windowEnd ? ` (≤${s.windowEnd})` : ""}
                              {s.late ? " · late" : ""}
                            </li>
                          ))}
                          {r.pathMode === "sequence" && r.routeEnd ? (
                            <li key={`${r.key}-end`}>Return · {r.routeEnd.label}</li>
                          ) : null}
                        </ol>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {planPreview.unassigned.length > 0 ? (
                  <p className="dispatch-search-hint">
                    Unassigned:{" "}
                    {planPreview.unassigned
                      .slice(0, 8)
                      .map((u) => u.label || u.orderId)
                      .join(", ")}
                    {planPreview.unassigned.length > 8
                      ? ` (+${planPreview.unassigned.length - 8} more)`
                      : ""}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        )}

        {showNewJob && (
          <section className="dispatch-rail dispatch-create">
            <header className="dispatch-pane-head">
              <p className="dispatch-eyebrow">Fleet run</p>
              <h2>New job</h2>
            </header>
            <div className="dispatch-create-grid">
              <label className="field">
                Title
                <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Van B 02 · AM run" />
              </label>
              <label className="field">
                Assign to
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {fieldUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName || u.username}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Group
                <select
                  value={groupId}
                  onChange={(e) => {
                    setGroupId(e.target.value);
                    setUserId("");
                  }}
                >
                  <option value="">None</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {groupOptionLabel(g)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Vehicle
                <select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!selectedGroup}>
                  <option value="">{selectedGroup ? "Select vehicle" : "Pick group first"}</option>
                  {users.map((u) => {
                    const cap = capacityForVehicle(vehicleCaps, Number(u.id));
                    return (
                      <option key={u.id} value={u.id}>
                        {userOptionLabel(u)} · {cap.volumeCapacityM3} m³ / {cap.weightCapacityKg} kg
                      </option>
                    );
                  })}
                </select>
              </label>
              <div className="field">
                <label htmlFor="dispatch-new-cap-vol">Volume capacity (m³)</label>
                <input
                  id="dispatch-new-cap-vol"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={jobVolCap}
                  onChange={(e) => setJobVolCap(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="dispatch-new-cap-wt">Weight capacity (kg)</label>
                <input
                  id="dispatch-new-cap-wt"
                  type="number"
                  min="1"
                  step="1"
                  value={jobWtCap}
                  onChange={(e) => setJobWtCap(e.target.value)}
                />
              </div>
            </div>
            <p className="dispatch-search-hint">
              Caps follow the vehicle preset when you pick a vehicle. Change them here for this job only, or save as
              default from the vehicle pane after create.
            </p>
            <div className="dispatch-create-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleCreateJob()}>
                Create job
              </button>
            </div>
          </section>
        )}

        <div className="dispatch-board-3col">
          <section className="dispatch-rail dispatch-pool">
            <header className="dispatch-pane-head">
              <p className="dispatch-eyebrow">Inbox · {formatServiceDateLabel(planDate)}</p>
              <h2>Orders</h2>
            </header>

            <div className="dispatch-search-wrap">
              <div className="dispatch-place-mode" role="tablist" aria-label="Place picker mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={placeMode === "poi"}
                  className={placeMode === "poi" ? "is-active" : undefined}
                  onClick={() => {
                    setPlaceMode("poi");
                    setSearchQ("");
                    setSearchResults([]);
                  }}
                >
                  POI
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={placeMode === "search"}
                  className={placeMode === "search" ? "is-active" : undefined}
                  onClick={() => {
                    setPlaceMode("search");
                    setPoiPickKey("");
                    setPoiFilter("");
                  }}
                >
                  Street / other
                </button>
              </div>

              {placeMode === "poi" ? (
                <>
                  <div className="field">
                    <label htmlFor="dispatch-poi-filter">Filter POIs</label>
                    <input
                      id="dispatch-poi-filter"
                      value={poiFilter}
                      onChange={(e) => setPoiFilter(e.target.value)}
                      placeholder="Type to narrow the list…"
                      autoComplete="off"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="dispatch-poi-select">Armada POI</label>
                    <select
                      id="dispatch-poi-select"
                      value={poiPickKey}
                      disabled={!poiCatalogReady || poiOptions.length === 0}
                      onChange={(e) => applyPoiKey(e.target.value)}
                    >
                      <option value="">
                        {!poiCatalogReady
                          ? "Loading POIs…"
                          : poiCatalog.length === 0
                            ? "No POIs with coordinates"
                            : poiOptions.length === 0
                              ? "No matches — clear filter"
                              : `Select POI (${poiOptions.length})`}
                      </option>
                      {poiOptions.map((p) => {
                        const result = placeResultFromPoi(p);
                        if (!result) return null;
                        const cat = (p.categoryName || "").trim();
                        return (
                          <option key={result.key} value={result.key}>
                            {p.name}
                            {cat ? ` · ${cat}` : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <p className="dispatch-search-hint">
                    All Armada POIs with coordinates appear here — no service-point link required. Or switch to
                    Street / other for free-text search, or click the map.
                  </p>
                </>
              ) : (
                <>
                  <div className="dispatch-search-box">
                    <span className="dispatch-search-icon" aria-hidden>
                      ⌕
                    </span>
                    <input
                      value={searchQ}
                      onChange={(e) => setSearchQ(e.target.value)}
                      placeholder="Search service point, street, area…"
                      autoComplete="off"
                      aria-label="Find place"
                    />
                  </div>
                  {searchBusy ? <p className="dispatch-search-hint">Searching…</p> : null}
                  {searchResults.length > 0 ? (
                    <ul className="dispatch-search-results">
                      {searchResults.map((r) => (
                        <li key={r.key}>
                          <button type="button" onClick={() => applyPin(r)}>
                            <span className="dispatch-search-result-main">
                              <span
                                className={`dispatch-search-source dispatch-search-source-${r.source}`}
                              >
                                {placeSearchSourceLabel(r.source)}
                              </span>
                              <span className="dispatch-search-label">{r.label}</span>
                            </span>
                            {r.subtitle ? (
                              <span className="dispatch-search-sub">{r.subtitle}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="dispatch-search-hint">
                      Free-text search for service points and streets — or click the map to drop a pin.
                    </p>
                  )}
                </>
              )}
            </div>

            {placing || draftPin ? (
              <div className="dispatch-order-draft">
                <p className="dispatch-eyebrow">{editingOrderId ? "Edit order" : "New stop"}</p>
                {draftPin && pinLabel ? (
                  <div className="dispatch-pin-chip" title={orderForm.address}>
                    <span className="dispatch-pin-dot" aria-hidden />
                    <span>
                      {pinBusy ? "Resolving address…" : "Pinned"}
                      <strong>{pinLabel}</strong>
                    </span>
                  </div>
                ) : (
                  <p className="dispatch-search-hint">Click the map to set the delivery point.</p>
                )}
                <label className="field">
                  Customer
                  <input
                    value={orderForm.customerName}
                    onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))}
                    placeholder="Toko Sari Maju"
                  />
                </label>
                <label className="field">
                  Reference
                  <input
                    value={orderForm.externalRef}
                    onChange={(e) => setOrderForm((f) => ({ ...f, externalRef: e.target.value }))}
                    placeholder="#ORD-1842"
                  />
                </label>
                <div className="dispatch-order-form-row">
                  <label className="field">
                    Zone
                    <input
                      value={orderForm.zone}
                      onChange={(e) => setOrderForm((f) => ({ ...f, zone: e.target.value }))}
                      placeholder="Dago"
                    />
                  </label>
                  <label className="field">
                    m³
                    <input
                      value={orderForm.volumeM3}
                      onChange={(e) => setOrderForm((f) => ({ ...f, volumeM3: e.target.value }))}
                      inputMode="decimal"
                    />
                  </label>
                  <label className="field">
                    kg
                    <input
                      value={orderForm.weightKg}
                      onChange={(e) => setOrderForm((f) => ({ ...f, weightKg: e.target.value }))}
                      inputMode="decimal"
                    />
                  </label>
                </div>
                <div className="dispatch-window-block">
                  <div className="dispatch-window-head">
                    <span className="dispatch-eyebrow">Delivery window</span>
                    {(orderForm.windowStart || orderForm.windowEnd) && (
                      <span className="dispatch-window-summary">
                        {formatDispatchWindow({
                          windowStart: orderForm.windowStart,
                          windowEnd: orderForm.windowEnd,
                        }) || "Any time"}
                      </span>
                    )}
                  </div>
                  <div className="dispatch-window-presets" role="group" aria-label="Window presets">
                    {WINDOW_PRESETS.map((p) => {
                      const active = activeWindowPreset(orderForm.windowStart, orderForm.windowEnd) === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`dispatch-window-chip${active ? " is-active" : ""}`}
                          onClick={() =>
                            setOrderForm((f) => ({
                              ...f,
                              windowStart: p.start,
                              windowEnd: p.end,
                            }))
                          }
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="dispatch-order-form-row dispatch-order-form-row-2">
                    <label className="field">
                      Arrive from
                      <input
                        type="time"
                        step={300}
                        value={orderForm.windowStart}
                        onChange={(e) => setOrderForm((f) => ({ ...f, windowStart: e.target.value }))}
                      />
                    </label>
                    <label className="field">
                      Arrive by
                      <input
                        type="time"
                        step={300}
                        value={orderForm.windowEnd}
                        onChange={(e) => setOrderForm((f) => ({ ...f, windowEnd: e.target.value }))}
                      />
                    </label>
                  </div>
                  {orderForm.windowStart &&
                  orderForm.windowEnd &&
                  orderForm.windowStart >= orderForm.windowEnd ? (
                    <p className="dispatch-window-warn">End time should be after start time.</p>
                  ) : null}
                </div>
                <div className="dispatch-order-form-row dispatch-order-form-row-2">
                  <label className="field">
                    Stop time (min)
                    <input
                      type="number"
                      min={0}
                      max={120}
                      step={1}
                      value={orderForm.serviceMinutes}
                      onChange={(e) => setOrderForm((f) => ({ ...f, serviceMinutes: e.target.value }))}
                      placeholder={`Default ${planServiceMin || 8}`}
                    />
                  </label>
                  <p className="dispatch-search-hint" style={{ alignSelf: "end", margin: 0 }}>
                    Time at the location for delivery/pickup. Leave blank to use Auto-plan “Service min /
                    stop”.
                  </p>
                </div>
                <label className="dispatch-plan-check" style={{ marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={orderForm.proofRequired}
                    onChange={(e) => setOrderForm((f) => ({ ...f, proofRequired: e.target.checked }))}
                  />
                  Proof photo required (Mobile Dispatch FINISH)
                </label>
                <div className="dispatch-create-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || orderForm.lat == null}
                    onClick={() => void handleSaveOrder()}
                  >
                    {editingOrderId ? "Save changes" : "Add to pool"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={clearDraft}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <div className="dispatch-pool-list-wrap">
              {orders.length === 0 && !placing ? (
                <div className="dispatch-empty">
                  <p>No pending orders</p>
                  <span>Search a place or pin the map to start a run.</span>
                </div>
              ) : (
                <ul className="dispatch-order-list">
                  {orders.map((o) => (
                    <li key={o.id}>
                      <div
                        className={`dispatch-order-card${selectedOrderIds.includes(o.id) ? " is-selected" : ""}${
                          editingOrderId === o.id ? " is-editing" : ""
                        }`}
                      >
                        <label className="dispatch-order-card-select">
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.includes(o.id)}
                            onChange={() => toggleOrder(o.id)}
                            disabled={editingOrderId === o.id}
                          />
                          <span className="visually-hidden">Select {o.customerName || "order"}</span>
                        </label>
                        <span className="dispatch-order-card-body">
                          <span className="dispatch-order-card-top">
                            <strong>{o.customerName || o.externalRef || "Order"}</strong>
                            {o.zone ? <span className="dispatch-zone-tag">{o.zone}</span> : null}
                            {o.proofRequired ? (
                              <span className="dispatch-zone-tag" title="Proof photo required on FINISH">
                                POD req
                              </span>
                            ) : null}
                          </span>
                          {o.address ? <span className="dispatch-order-addr">{o.address}</span> : null}
                          <span className="dispatch-order-meta">
                            {o.volumeM3 != null ? `${o.volumeM3} m³` : "—"}
                            <span aria-hidden>·</span>
                            {o.weightKg != null ? `${o.weightKg} kg` : "—"}
                            <span aria-hidden>·</span>
                            {formatDispatchWindow(o) || "Open window"}
                            {formatDispatchServiceMinutes(o) ? (
                              <>
                                <span aria-hidden>·</span>
                                {formatDispatchServiceMinutes(o)}
                              </>
                            ) : null}
                          </span>
                          <span className="dispatch-order-actions">
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => startEditOrder(o)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={busy}
                              onClick={() => void handleCancelOrder(o)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn-secondary dispatch-order-delete"
                              disabled={busy}
                              onClick={() => void handleDeleteOrder(o)}
                            >
                              Delete
                            </button>
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              className="btn btn-primary dispatch-assign-btn"
              disabled={busy || !selected || !selectedOrderIds.length}
              onClick={() => void handleAssignSelected()}
            >
              {selectedOrderIds.length
                ? `Assign ${selectedOrderIds.length} to ${selected?.title || "job"}`
                : "Select orders to assign"}
            </button>
          </section>

          <section className="dispatch-rail dispatch-map-pane">
            <header className="dispatch-pane-head">
              <div>
                <p className="dispatch-eyebrow">Live board · {formatServiceDateLabel(planDate)}</p>
                <h2>{selected ? selected.title : "Route map"}</h2>
              </div>
              <span className="dispatch-map-badge">{selected?.stops.length || 0} stops</span>
            </header>
            <div className="dispatch-map-frame">
              <DispatchJobMap
                stops={selected?.stops || []}
                fitKey={fitKey}
                draftPin={mapDraftPin}
                routeGeometry={jobRoute?.geometry || []}
                routeStart={
                  selected?.routeAnchorMode === "map" || selected?.routeAnchorMode === "sequence"
                    ? selected.routeStart
                    : null
                }
                routeEnd={
                  selected?.routeAnchorMode === "map" || selected?.routeAnchorMode === "sequence"
                    ? selected.routeEnd
                    : null
                }
                onMapClick={(lat, lon) => void onMapClick(lat, lon)}
              />
            </div>
            {selected && selected.stops.filter((s) => s.lat != null && s.lon != null).length >= 2 ? (
              <p className="dispatch-route-banner" role="status">
                {routeBusy && !jobRoute
                  ? "Loading road path…"
                  : jobRoute?.engine === "osrm"
                    ? `Road route · ${jobRoute.distanceKm ?? "—"} km · ${formatRouteDuration(jobRoute.durationSec)}`
                    : `Straight-line estimate${jobRoute?.distanceKm != null ? ` · ${jobRoute.distanceKm} km` : ""}${
                        jobRoute?.durationSec != null ? ` · ${formatRouteDuration(jobRoute.durationSec)}` : ""
                      }${jobRoute?.warning ? ` · ${jobRoute.warning}` : " · set OSRM_BASE_URL for roads"}`}
              </p>
            ) : null}
            <ul className="dispatch-job-tabs">
              {jobs.map((j) => (
                <li key={j.id} className="dispatch-job-tab-wrap">
                  <button
                    type="button"
                    className={`dispatch-job-tab${selectedId === j.id ? " is-active" : ""}`}
                    onClick={() => setSelectedId(j.id)}
                  >
                    <span className={`dispatch-status dispatch-status-${j.status}`}>
                      {DISPATCH_STATUS_LABELS[j.status]}
                    </span>
                    <strong>{j.title}</strong>
                    <span>
                      {j.stops.length} stops · {j.utilizationPct ?? 0}%
                    </span>
                  </button>
                  {j.status === "draft" || j.status === "assigned" ? (
                    <button
                      type="button"
                      className="dispatch-job-tab-cancel"
                      disabled={busy}
                      title="Cancel job"
                      aria-label={`Cancel job ${j.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCancelJob(j);
                      }}
                    >
                      Cancel
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="dispatch-rail dispatch-vehicle-pane">
            {!selected ? (
              <div className="dispatch-empty">
                <p className="dispatch-eyebrow">Vehicle</p>
                <h2>No job selected</h2>
                <span>Create a job, then assign pinned orders from the pool.</span>
              </div>
            ) : (
              <>
                <header className="dispatch-pane-head">
                  <div>
                    <p className="dispatch-eyebrow">Vehicle load</p>
                    <h2>{selected.title}</h2>
                  </div>
                  <span className={`dispatch-status dispatch-status-${selected.status}`}>
                    {DISPATCH_STATUS_LABELS[selected.status]}
                  </span>
                </header>
                <p className="dispatch-vehicle-meta">
                  <span>{dispatchAssigneeLabel(selected)}</span>
                  <span aria-hidden>·</span>
                  <span>{dispatchVehicleLabel(selected)}</span>
                </p>

                <div
                  className="dispatch-capacity"
                  style={{ ["--fill" as string]: Math.min(100, selected.utilizationPct ?? 0) }}
                >
                  <div className="dispatch-capacity-ring" aria-hidden>
                    <strong>{Math.round(selected.utilizationPct ?? 0)}</strong>
                    <span>%</span>
                  </div>
                  <div className="dispatch-capacity-metrics">
                    <div>
                      <div className="dispatch-cap-label">
                        <span>Volume</span>
                        <span>
                          {selected.volumeUsed ?? 0} / {selected.volumeCapacityM3 ?? 12} m³
                        </span>
                      </div>
                      <div className="dispatch-cap-bar">
                        <div
                          className={`dispatch-cap-fill dispatch-util-${utilizationTone(
                            ((selected.volumeUsed || 0) / (selected.volumeCapacityM3 || 12)) * 100,
                          )}`}
                          style={{
                            width: `${Math.min(
                              100,
                              ((selected.volumeUsed || 0) / (selected.volumeCapacityM3 || 12)) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="dispatch-cap-label">
                        <span>Weight</span>
                        <span>
                          {selected.weightUsed ?? 0} / {selected.weightCapacityKg ?? 1500} kg
                        </span>
                      </div>
                      <div className="dispatch-cap-bar">
                        <div
                          className={`dispatch-cap-fill dispatch-util-${utilizationTone(
                            ((selected.weightUsed || 0) / (selected.weightCapacityKg || 1500)) * 100,
                          )}`}
                          style={{
                            width: `${Math.min(
                              100,
                              ((selected.weightUsed || 0) / (selected.weightCapacityKg || 1500)) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="dispatch-cap-edit">
                  <p className="dispatch-eyebrow">Vehicle capacity</p>
                  <div className="dispatch-cap-edit-fields">
                    <div className="field">
                      <label htmlFor="dispatch-cap-vol">Volume (m³)</label>
                      <input
                        id="dispatch-cap-vol"
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={editVolCap}
                        disabled={busy || selected.status === "done" || selected.status === "cancelled"}
                        onChange={(e) => setEditVolCap(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="dispatch-cap-wt">Weight (kg)</label>
                      <input
                        id="dispatch-cap-wt"
                        type="number"
                        min="1"
                        step="1"
                        value={editWtCap}
                        disabled={busy || selected.status === "done" || selected.status === "cancelled"}
                        onChange={(e) => setEditWtCap(e.target.value)}
                      />
                    </div>
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor="dispatch-cap-depot">Home depot</label>
                      <select
                        id="dispatch-cap-depot"
                        value={editDepotId}
                        disabled={busy || selected.status === "done" || selected.status === "cancelled"}
                        onChange={(e) => setEditDepotId(e.target.value)}
                      >
                        <option value="">Auto-balance (multi-depot)</option>
                        {depots.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                            {d.isDefault ? " · default" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label htmlFor="dispatch-cap-plate">Plate parity</label>
                      <select
                        id="dispatch-cap-plate"
                        value={editPlateParity}
                        disabled={busy || selected.status === "done" || selected.status === "cancelled"}
                        onChange={(e) => setEditPlateParity(e.target.value as typeof editPlateParity)}
                      >
                        <option value="unknown">Unknown</option>
                        <option value="odd">Odd (ganjil)</option>
                        <option value="even">Even (genap)</option>
                        <option value="exempt">Exempt</option>
                      </select>
                    </div>
                  </div>
                  <div className="dispatch-cap-edit-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy || selected.status === "done" || selected.status === "cancelled"}
                      onClick={() => void handleApplyJobCapacity()}
                    >
                      Apply to job
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        busy ||
                        !selected.armadaUserId ||
                        selected.status === "done" ||
                        selected.status === "cancelled"
                      }
                      title={
                        selected.armadaUserId
                          ? "Remember this capacity for the Armada vehicle"
                          : "Job needs an Armada vehicle"
                      }
                      onClick={() => void handleSaveVehicleDefault()}
                    >
                      Save as vehicle default
                    </button>
                  </div>
                </div>

                <div className="dispatch-detail-actions">
                  <label className="field">
                    Assignee
                    <select
                      value={selected.assignedFieldUserId || ""}
                      disabled={busy || selected.status === "done" || selected.status === "cancelled"}
                      onChange={(e) =>
                        void updateJob(selected.id, { assignedFieldUserId: e.target.value || null })
                      }
                    >
                      <option value="">Unassigned</option>
                      {fieldUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName || u.username}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Status
                    <select
                      value={selected.status}
                      disabled={busy || selected.status === "cancelled"}
                      onChange={(e) => void updateJob(selected.id, { status: e.target.value })}
                    >
                      {(Object.keys(DISPATCH_STATUS_LABELS) as DispatchStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {DISPATCH_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected.status === "draft" || selected.status === "assigned" ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ gridColumn: "1 / -1" }}
                      disabled={busy}
                      onClick={() => void handleCancelJob(selected)}
                    >
                      Cancel job
                    </button>
                  ) : null}
                </div>

                <div className="dispatch-routing-opts">
                  <label className="dispatch-plan-check">
                    <input
                      type="checkbox"
                      checked={avoidTolls}
                      onChange={(e) => setAvoidTolls(e.target.checked)}
                    />
                    Avoid tolls
                  </label>
                  <label className="dispatch-plan-check">
                    <input
                      type="checkbox"
                      checked={avoidMotorways}
                      onChange={(e) => setAvoidMotorways(e.target.checked)}
                    />
                    Avoid motorways
                  </label>
                  <label className="dispatch-plan-check">
                    <input
                      type="checkbox"
                      checked={avoidFerries}
                      onChange={(e) => setAvoidFerries(e.target.checked)}
                    />
                    Avoid ferries
                  </label>
                  <label className="dispatch-plan-check">
                    <input
                      type="checkbox"
                      checked={respectGanjilGenap}
                      onChange={(e) => setRespectGanjilGenap(e.target.checked)}
                    />
                    Jakarta ganjil–genap
                  </label>
                </div>
                {respectGanjilGenap ? (
                  <div className="field">
                    <label htmlFor="dispatch-job-plate">Plate parity</label>
                    <select
                      id="dispatch-job-plate"
                      value={plateParity}
                      onChange={(e) => setPlateParity(e.target.value as typeof plateParity)}
                    >
                      <option value="unknown">Use vehicle default</option>
                      <option value="odd">Odd (ganjil)</option>
                      <option value="even">Even (genap)</option>
                      <option value="exempt">Exempt</option>
                    </select>
                  </div>
                ) : null}
                <button type="button" className="btn-secondary dispatch-opt-btn" disabled={busy} onClick={() => void handleOptimize()}>
                  Optimize stop order
                </button>

                <div className="dispatch-sequence">
                  <div className="dispatch-sequence-head">
                    <p className="dispatch-eyebrow">Sequence</p>
                    <span>
                      {selected.stops.length} stops
                      {jobRoute?.distanceKm != null ? ` · ${jobRoute.distanceKm} km` : ""}
                    </span>
                  </div>
                  {selected.stops.length === 0 && !selected.routeStart ? (
                    <p className="dispatch-search-hint">Assign orders from the pool.</p>
                  ) : (
                    <ol className="dispatch-stop-list">
                      {selected.routeAnchorMode === "sequence" && selected.routeStart ? (
                        <li key="route-start" className="dispatch-stop-anchor">
                          <span className="dispatch-stop-idx">D</span>
                          <div className="dispatch-stop-body">
                            <strong>{selected.routeStart.label}</strong>
                            <span>Depot / start</span>
                          </div>
                        </li>
                      ) : null}
                      {selected.stops.map((stop, i) => {
                        const meta = stopRouteMeta[i];
                        return (
                          <li key={stop.id}>
                            <span className="dispatch-stop-idx">{i + 1}</span>
                            <div className="dispatch-stop-body">
                              <strong>{stop.name}</strong>
                              <span>
                                {stop.status}
                                {stop.zone ? ` · ${stop.zone}` : ""}
                                {stop.volumeM3 != null ? ` · ${stop.volumeM3} m³` : ""}
                                {formatDispatchWindow(stop) ? ` · ${formatDispatchWindow(stop)}` : ""}
                                {formatDispatchServiceMinutes(stop, Number(planServiceMin) || 8)
                                  ? ` · ${formatDispatchServiceMinutes(stop, Number(planServiceMin) || 8)}`
                                  : ""}
                              </span>
                              <span className="dispatch-stop-leg">
                                {i === 0 ? (
                                  <>ETA {meta?.eta || "—"} · start</>
                                ) : (
                                  <>
                                    {meta?.legDistanceKm != null ? `${meta.legDistanceKm} km` : "—"}
                                    <span aria-hidden> · </span>
                                    {formatRouteDuration(meta?.legDurationSec)}
                                    <span aria-hidden> · </span>
                                    ETA {meta?.eta || "—"}
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="dispatch-stop-actions">
                              <button
                                type="button"
                                className="btn-secondary dispatch-proof-btn"
                                onClick={() => setProofStopId(proofStopId === stop.id ? null : stop.id)}
                              >
                                POD
                              </button>
                              <button
                                type="button"
                                className="btn-secondary dispatch-return-btn"
                                disabled={
                                  busy || selected.status === "done" || selected.status === "cancelled"
                                }
                                title="Remove from this job and return order to inbox"
                                onClick={() => void handleReturnStop(stop.id, stop.name)}
                              >
                                To inbox
                              </button>
                            </div>
                          </li>
                        );
                      })}
                      {selected.routeAnchorMode === "sequence" && selected.routeEnd ? (
                        <li key="route-end" className="dispatch-stop-anchor">
                          <span className="dispatch-stop-idx">R</span>
                          <div className="dispatch-stop-body">
                            <strong>{selected.routeEnd.label}</strong>
                            <span>Return</span>
                          </div>
                        </li>
                      ) : null}
                    </ol>
                  )}
                </div>

                {proofStopId ? (
                  <div className="dispatch-proof-box">
                    <p className="dispatch-eyebrow">Proof of delivery</p>
                    {proofPhotos.length === 0 ? (
                      <p className="dispatch-search-hint">No photos yet for this stop.</p>
                    ) : (
                      <div className="dispatch-proof-thumbs">
                        {proofPhotos.map((p) => (
                          <a key={p.id} href={withTenantQuery(p.url)} target="_blank" rel="noreferrer">
                            <img src={withTenantQuery(p.url)} alt={p.caption || "POD"} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function shortCustomerFromLabel(label: string): string {
  const first = label.split(",")[0]?.trim() || "";
  return first.slice(0, 80);
}
