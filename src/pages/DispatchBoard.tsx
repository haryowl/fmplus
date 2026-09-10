import { useEffect, useMemo, useState } from "react";
import { fetchGroups, fetchUsersForGroup, groupOptionLabel, userOptionLabel } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { DispatchJobMap } from "../components/DispatchJobMap";
import { ViewNav } from "../components/ViewNav";
import {
  assignOrdersToJob,
  createDispatchJob,
  createDispatchOrder,
  DISPATCH_STATUS_LABELS,
  dispatchAssigneeLabel,
  dispatchVehicleLabel,
  fetchDispatchFieldUsers,
  fetchDispatchJobs,
  fetchDispatchOrders,
  fetchStopPhotos,
  formatDispatchWindow,
  optimizeJobStops,
  patchDispatchJob,
  utilizationTone,
  withTenantQuery,
  type DispatchFieldUser,
  type DispatchJob,
  type DispatchOrder,
  type DispatchPhoto,
  type DispatchStatus,
} from "../lib/dispatch";
import { reverseAddress, searchAddresses, type GeocodeResult } from "../lib/geocode";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";

const emptyOrderForm = {
  customerName: "",
  externalRef: "",
  address: "",
  zone: "",
  volumeM3: "",
  weightKg: "",
  windowStart: "",
  windowEnd: "",
  lat: null as number | null,
  lon: null as number | null,
};

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
  const [showNewJob, setShowNewJob] = useState(false);
  const [proofStopId, setProofStopId] = useState<string | null>(null);
  const [proofPhotos, setProofPhotos] = useState<DispatchPhoto[]>([]);

  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [placing, setPlacing] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);

  const [jobTitle, setJobTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const selectedUser = users.find((u) => String(u.id) === userId);
  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) || null, [jobs, selectedId]);
  const draftPin =
    orderForm.lat != null && orderForm.lon != null
      ? { lat: orderForm.lat, lon: orderForm.lon }
      : null;
  const fitKey = selected
    ? `${selected.id}-${selected.stops.map((s) => s.id).join(",")}-${draftPin ? "pin" : ""}`
    : `empty-${draftPin ? `${draftPin.lat},${draftPin.lon}` : ""}`;

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
    fetchDispatchFieldUsers()
      .then((list) => {
        if (!cancelled) setFieldUsers(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, query.tenantKey, reload]);

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
    Promise.all([fetchDispatchJobs("open", ac.signal), fetchDispatchOrders("pending", ac.signal)])
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
  }, [ready, query.tenantKey, reload]);

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
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      setSearchBusy(true);
      searchAddresses(q, ac.signal)
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
  }, [searchQ]);

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function applyPin(result: GeocodeResult) {
    setOrderForm((f) => ({
      ...f,
      address: result.label,
      lat: result.lat,
      lon: result.lon,
      customerName: f.customerName || shortCustomerFromLabel(result.label),
    }));
    setPlacing(true);
    setSearchQ("");
    setSearchResults([]);
    setError("");
  }

  async function onMapClick(lat: number, lon: number) {
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
    setPlacing(false);
    setSearchQ("");
    setSearchResults([]);
  }

  async function handleCreateOrder() {
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
    try {
      await createDispatchOrder({
        customerName: orderForm.customerName.trim(),
        externalRef: orderForm.externalRef.trim() || undefined,
        address: orderForm.address.trim() || undefined,
        zone: orderForm.zone.trim() || undefined,
        volumeM3: orderForm.volumeM3 === "" ? null : Number(orderForm.volumeM3),
        weightKg: orderForm.weightKg === "" ? null : Number(orderForm.weightKg),
        windowStart: orderForm.windowStart.trim() || undefined,
        windowEnd: orderForm.windowEnd.trim() || undefined,
        lat: orderForm.lat,
        lon: orderForm.lon,
      });
      clearDraft();
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create order failed");
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
      const job = await createDispatchJob({
        title: jobTitle.trim(),
        assignedFieldUserId: assigneeId || null,
        armadaUserId: selectedUser ? Number(selectedUser.id) : null,
        armadaUsername: selectedUser?.username || "",
        userDisplayName: selectedUser ? userOptionLabel(selectedUser) : "",
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

  async function handleAssignSelected() {
    if (!selected || !selectedOrderIds.length) return;
    setBusy(true);
    setError("");
    try {
      const job = await assignOrdersToJob(selected.id, selectedOrderIds);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      setSelectedOrderIds([]);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleOptimize() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const job = await optimizeJobStops(selected.id);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimize failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateJob(id: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const job = await patchDispatchJob(id, patch);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
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
            <p>Search or click the map · assign · field execution</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchDesk" />
          <div className="vehicle-chip">{loading ? "Loading…" : `${kpis.openJobs} jobs`}</div>
        </div>
      </header>

      <main className="shell">
        <section className="dispatch-kpi-strip" aria-label="Dispatch KPIs">
          <div className="dispatch-kpi">
            <span className="muted">Unassigned</span>
            <strong>{kpis.openOrders}</strong>
          </div>
          <div className="dispatch-kpi">
            <span className="muted">Open jobs</span>
            <strong>{kpis.openJobs}</strong>
          </div>
          <div className="dispatch-kpi">
            <span className="muted">Avg fill</span>
            <strong className={`dispatch-util-${utilizationTone(kpis.avgUtil)}`}>{kpis.avgUtil}%</strong>
          </div>
          <div className="dispatch-kpi-actions">
            <button type="button" className="btn-ghost" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
            <button type="button" className="btn-ghost" onClick={() => setShowNewJob((v) => !v)}>
              {showNewJob ? "Hide job" : "New job"}
            </button>
          </div>
        </section>

        {(bootError || error) && (
          <p className="muted" role="alert" style={{ color: "var(--danger, #b42318)" }}>
            {error || bootError}
          </p>
        )}

        {showNewJob && (
          <section className="panel dispatch-create">
            <h2>New job / vehicle run</h2>
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
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {userOptionLabel(u)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="dispatch-create-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleCreateJob()}>
                Create job
              </button>
            </div>
          </section>
        )}

        <div className="dispatch-board-3col">
          <section className="panel dispatch-pool">
            <header className="dispatch-pane-head">
              <h2>Orders</h2>
            </header>

            <div className="dispatch-search-wrap">
              <label className="field">
                Find place
                <input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Street, area, landmark…"
                  autoComplete="off"
                />
              </label>
              {searchBusy ? <p className="muted dispatch-search-hint">Searching…</p> : null}
              {searchResults.length > 0 ? (
                <ul className="dispatch-search-results">
                  {searchResults.map((r) => (
                    <li key={`${r.lat},${r.lon},${r.label}`}>
                      <button type="button" onClick={() => applyPin(r)}>
                        {r.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="muted dispatch-search-hint">Or click the map to drop a pin.</p>
            </div>

            {placing || draftPin ? (
              <div className="dispatch-order-draft">
                {draftPin && pinLabel ? (
                  <div className="dispatch-pin-chip" title={orderForm.address}>
                    <span className="dispatch-pin-dot" aria-hidden />
                    Pinned · {pinLabel}
                    {pinBusy ? " · resolving…" : ""}
                  </div>
                ) : (
                  <p className="muted">Click the map to set the delivery point.</p>
                )}
                <label className="field">
                  Customer / stop name
                  <input
                    value={orderForm.customerName}
                    onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))}
                    placeholder="Toko Sari Maju"
                  />
                </label>
                <label className="field">
                  Ref (optional)
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
                <div className="dispatch-order-form-row">
                  <label className="field">
                    Window start
                    <input
                      value={orderForm.windowStart}
                      onChange={(e) => setOrderForm((f) => ({ ...f, windowStart: e.target.value }))}
                      placeholder="09:00"
                    />
                  </label>
                  <label className="field">
                    Window end
                    <input
                      value={orderForm.windowEnd}
                      onChange={(e) => setOrderForm((f) => ({ ...f, windowEnd: e.target.value }))}
                      placeholder="11:00"
                    />
                  </label>
                </div>
                <div className="dispatch-create-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || orderForm.lat == null}
                    onClick={() => void handleCreateOrder()}
                  >
                    Add to pool
                  </button>
                  <button type="button" className="btn-ghost" onClick={clearDraft}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {orders.length === 0 && !placing ? (
              <p className="muted">No pending orders. Search an address or click the map.</p>
            ) : (
              <ul className="dispatch-order-list">
                {orders.map((o) => (
                  <li key={o.id}>
                    <label className={`dispatch-order-card${selectedOrderIds.includes(o.id) ? " is-selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.includes(o.id)}
                        onChange={() => toggleOrder(o.id)}
                      />
                      <span className="dispatch-order-card-body">
                        <span className="dispatch-order-card-top">
                          <strong>{o.customerName || o.externalRef || "Order"}</strong>
                          {o.zone ? <span className="dispatch-zone-tag">{o.zone}</span> : null}
                        </span>
                        {o.address ? <span className="muted dispatch-order-addr">{o.address}</span> : null}
                        <span className="muted dispatch-order-meta">
                          {o.volumeM3 != null ? `${o.volumeM3} m³` : "—"} ·{" "}
                          {o.weightKg != null ? `${o.weightKg} kg` : "—"} ·{" "}
                          {formatDispatchWindow(o) || "no window"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              className="btn btn-primary dispatch-assign-btn"
              disabled={busy || !selected || !selectedOrderIds.length}
              onClick={() => void handleAssignSelected()}
            >
              Assign {selectedOrderIds.length || ""} to selected job
            </button>
          </section>

          <section className="panel dispatch-map-pane">
            <header className="dispatch-pane-head">
              <h2>Map</h2>
              <span className="muted">{selected ? selected.title : "Click to pin orders"}</span>
            </header>
            <DispatchJobMap
              stops={selected?.stops || []}
              fitKey={fitKey}
              draftPin={draftPin}
              onMapClick={(lat, lon) => void onMapClick(lat, lon)}
            />
            <p className="muted route-plan-map-hint">Click the map to pin a new order.</p>
            <ul className="dispatch-job-tabs">
              {jobs.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    className={`dispatch-job-tab${selectedId === j.id ? " is-active" : ""}`}
                    onClick={() => setSelectedId(j.id)}
                  >
                    <span className={`dispatch-status dispatch-status-${j.status}`}>
                      {DISPATCH_STATUS_LABELS[j.status]}
                    </span>
                    <strong>{j.title}</strong>
                    <span className="muted">
                      {j.stops.length} stops · {j.utilizationPct ?? 0}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel dispatch-vehicle-pane">
            {!selected ? (
              <>
                <h2>Vehicle / job</h2>
                <p className="muted">Create a job, then assign pinned orders from the pool.</p>
              </>
            ) : (
              <>
                <header className="dispatch-detail-head">
                  <h2>{selected.title}</h2>
                  <span className={`dispatch-status dispatch-status-${selected.status}`}>
                    {DISPATCH_STATUS_LABELS[selected.status]}
                  </span>
                </header>
                <p className="muted">
                  {dispatchAssigneeLabel(selected)} · {dispatchVehicleLabel(selected)}
                </p>

                <div className="dispatch-capacity">
                  <div className="dispatch-capacity-head">
                    <strong>{selected.utilizationPct ?? 0}%</strong>
                    <span className={`dispatch-util-${utilizationTone(selected.utilizationPct)}`}>utilized</span>
                  </div>
                  <div className="dispatch-cap-bar" aria-label="Volume capacity">
                    <div
                      className={`dispatch-cap-fill dispatch-util-${utilizationTone(
                        ((selected.volumeUsed || 0) / (selected.volumeCapacityM3 || 12)) * 100,
                      )}`}
                      style={{
                        width: `${Math.min(100, ((selected.volumeUsed || 0) / (selected.volumeCapacityM3 || 12)) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="muted">
                    Volume {selected.volumeUsed ?? 0} / {selected.volumeCapacityM3 ?? 12} m³
                  </p>
                  <div className="dispatch-cap-bar" aria-label="Weight capacity">
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
                  <p className="muted">
                    Weight {selected.weightUsed ?? 0} / {selected.weightCapacityKg ?? 1500} kg
                  </p>
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
                      disabled={busy}
                      onChange={(e) => void updateJob(selected.id, { status: e.target.value })}
                    >
                      {(Object.keys(DISPATCH_STATUS_LABELS) as DispatchStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {DISPATCH_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="dispatch-create-actions">
                  <button type="button" className="btn" disabled={busy} onClick={() => void handleOptimize()}>
                    Optimize stops
                  </button>
                </div>

                <h3>Sequence</h3>
                {selected.stops.length === 0 ? (
                  <p className="muted">Assign orders from the pool.</p>
                ) : (
                  <ol className="dispatch-stop-list">
                    {selected.stops.map((stop, i) => (
                      <li key={stop.id}>
                        <strong>
                          {i + 1}. {stop.name}
                        </strong>
                        <span className="muted">
                          {stop.status}
                          {stop.zone ? ` · ${stop.zone}` : ""}
                          {stop.volumeM3 != null ? ` · ${stop.volumeM3} m³` : ""}
                          {formatDispatchWindow(stop) ? ` · ${formatDispatchWindow(stop)}` : ""}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => setProofStopId(proofStopId === stop.id ? null : stop.id)}
                        >
                          Proof
                        </button>
                      </li>
                    ))}
                  </ol>
                )}

                {proofStopId ? (
                  <div className="dispatch-proof-box">
                    <h4>POD photos</h4>
                    {proofPhotos.length === 0 ? (
                      <p className="muted">No photos yet for this stop.</p>
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
