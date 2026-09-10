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
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";

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
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [showNewJob, setShowNewJob] = useState(false);
  const [proofStopId, setProofStopId] = useState<string | null>(null);
  const [proofPhotos, setProofPhotos] = useState<DispatchPhoto[]>([]);

  const [orderForm, setOrderForm] = useState({
    customerName: "",
    externalRef: "",
    address: "",
    zone: "",
    volumeM3: "",
    weightKg: "",
    windowStart: "",
    windowEnd: "",
    lat: "",
    lon: "",
  });
  const [jobTitle, setJobTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const selectedUser = users.find((u) => String(u.id) === userId);
  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) || null, [jobs, selectedId]);
  const fitKey = selected ? `${selected.id}-${selected.stops.map((s) => s.id).join(",")}` : "empty";

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
    Promise.all([
      fetchDispatchJobs("open", ac.signal),
      fetchDispatchOrders("pending", ac.signal),
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

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleCreateOrder() {
    if (!orderForm.customerName.trim()) {
      setError("Customer name required");
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
        lat: orderForm.lat === "" ? null : Number(orderForm.lat),
        lon: orderForm.lon === "" ? null : Number(orderForm.lon),
      });
      setOrderForm({
        customerName: "",
        externalRef: "",
        address: "",
        zone: "",
        volumeM3: "",
        weightKg: "",
        windowStart: "",
        windowEnd: "",
        lat: "",
        lon: "",
      });
      setShowNewOrder(false);
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

  return (
    <div className="app dispatch-page">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>Dispatch</h1>
            <p>Orders → capacity → assign → field execution</p>
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
            <span className="muted">Unassigned orders</span>
            <strong>{kpis.openOrders}</strong>
          </div>
          <div className="dispatch-kpi">
            <span className="muted">Open jobs</span>
            <strong>{kpis.openJobs}</strong>
          </div>
          <div className="dispatch-kpi">
            <span className="muted">Avg utilization</span>
            <strong className={`dispatch-util-${utilizationTone(kpis.avgUtil)}`}>{kpis.avgUtil}%</strong>
          </div>
          <div className="dispatch-kpi-actions">
            <button type="button" className="btn-ghost" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
            <button type="button" className="btn" onClick={() => setShowNewJob((v) => !v)}>
              New job
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
              <h2>Unassigned orders</h2>
              <button type="button" className="btn-ghost" onClick={() => setShowNewOrder((v) => !v)}>
                {showNewOrder ? "Hide" : "+ Order"}
              </button>
            </header>

            {showNewOrder && (
              <div className="dispatch-order-form">
                <label className="field">
                  Customer
                  <input
                    value={orderForm.customerName}
                    onChange={(e) => setOrderForm((f) => ({ ...f, customerName: e.target.value }))}
                  />
                </label>
                <label className="field">
                  Ref
                  <input
                    value={orderForm.externalRef}
                    onChange={(e) => setOrderForm((f) => ({ ...f, externalRef: e.target.value }))}
                    placeholder="#ORD-1842"
                  />
                </label>
                <label className="field">
                  Address
                  <input
                    value={orderForm.address}
                    onChange={(e) => setOrderForm((f) => ({ ...f, address: e.target.value }))}
                  />
                </label>
                <div className="dispatch-order-form-row">
                  <label className="field">
                    Zone
                    <input
                      value={orderForm.zone}
                      onChange={(e) => setOrderForm((f) => ({ ...f, zone: e.target.value }))}
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
                <div className="dispatch-order-form-row">
                  <label className="field">
                    Lat
                    <input
                      value={orderForm.lat}
                      onChange={(e) => setOrderForm((f) => ({ ...f, lat: e.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Lon
                    <input
                      value={orderForm.lon}
                      onChange={(e) => setOrderForm((f) => ({ ...f, lon: e.target.value }))}
                    />
                  </label>
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleCreateOrder()}>
                  Add to pool
                </button>
              </div>
            )}

            {orders.length === 0 ? (
              <p className="muted">No pending orders. Add one to start capacity planning.</p>
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
                          <strong>{o.externalRef || o.customerName}</strong>
                          {o.zone ? <span className="dispatch-zone-tag">{o.zone}</span> : null}
                        </span>
                        <span className="muted">{o.customerName}</span>
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
              <h2>Route map</h2>
              <span className="muted">{selected ? selected.title : "Select a job"}</span>
            </header>
            {selected && selected.stops.some((s) => s.lat != null && s.lon != null) ? (
              <DispatchJobMap stops={selected.stops} fitKey={fitKey} />
            ) : (
              <div className="dispatch-map-empty muted">
                {selected
                  ? "Add orders with coordinates to see the route."
                  : "Select or create a job, then assign orders."}
              </div>
            )}
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
                <p className="muted">Select a job to review capacity and sequence.</p>
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
                        width: `${Math.min(100, ((selected.weightUsed || 0) / (selected.weightCapacityKg || 1500)) * 100)}%`,
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
