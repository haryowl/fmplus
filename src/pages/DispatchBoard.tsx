import { useEffect, useMemo, useState } from "react";
import { fetchGroups, fetchUsersForGroup, groupOptionLabel, userOptionLabel } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { ViewNav } from "../components/ViewNav";
import {
  createDispatchJob,
  DISPATCH_STATUS_LABELS,
  dispatchAssigneeLabel,
  dispatchVehicleLabel,
  fetchDispatchFieldUsers,
  fetchDispatchJobs,
  parseStopPaste,
  patchDispatchJob,
  type DispatchFieldUser,
  type DispatchJob,
  type DispatchStatus,
} from "../lib/dispatch";
import { writeLocationSearch } from "../lib/routing";
import { useEmbedTenant } from "../lib/useEmbedTenant";
import type { Group, User } from "../lib/types";

type StatusFilter = "open" | "all" | DispatchStatus;

export default function DispatchBoard() {
  const {
    ready,
    error: tenantError,
    query,
    allowedUserIds,
    allowedGroupIds,
    allowsUser,
    allowsGroup,
  } = useEmbedTenant();
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [fieldUsers, setFieldUsers] = useState<DispatchFieldUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groupId, setGroupId] = useState(query.groupId);
  const [userId, setUserId] = useState(query.userId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bootError, setBootError] = useState("");
  const [reload, setReload] = useState(0);
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [stopPaste, setStopPaste] = useState("");

  const selectedGroup = groups.find((g) => String(g.id) === groupId);
  const selectedUser = users.find((u) => String(u.id) === userId);
  const selected = useMemo(
    () => jobs.find((j) => j.id === selectedId) || null,
    [jobs, selectedId],
  );

  useEffect(() => {
    document.title = "Dispatch · FM Plus";
  }, []);

  useEffect(() => {
    writeLocationSearch({
      groupId: groupId || null,
      userId: userId || null,
      status: statusFilter === "open" ? null : statusFilter,
    });
  }, [groupId, userId, statusFilter]);

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
      .catch((err: Error) => {
        if (err.name !== "AbortError") setBootError(err.message);
      });
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
      setError("Open with k= (tenant key) to load dispatch jobs.");
      setJobs([]);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError("");
    fetchDispatchJobs(statusFilter, ac.signal)
      .then((list) => {
        setJobs(list);
        setBootError("");
        if (selectedId && !list.some((j) => j.id === selectedId)) setSelectedId(null);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setJobs([]);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [ready, query.tenantKey, statusFilter, reload]);

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Title is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const stops = parseStopPaste(stopPaste).map((s) => ({
        name: s.name,
        lat: s.lat,
        lon: s.lon,
      }));
      const job = await createDispatchJob({
        title: trimmed,
        notes: notes.trim() || undefined,
        armadaUserId: selectedUser ? Number(selectedUser.id) : null,
        armadaUsername: selectedUser?.username || "",
        userDisplayName: selectedUser ? userOptionLabel(selectedUser) : "",
        assignedFieldUserId: assigneeId || null,
        stops,
      });
      setTitle("");
      setNotes("");
      setStopPaste("");
      setAssigneeId("");
      setShowCreate(false);
      setSelectedId(job.id);
      setReload((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
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
            <p>Assign jobs to field users · stops &amp; status on /m</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ViewNav current="dispatchDesk" />
          <div className="vehicle-chip">{loading ? "Loading…" : `${jobs.length} jobs`}</div>
        </div>
      </header>

      <main className="shell">
        <section className="filters">
          <div className="field">
            <label htmlFor="dj-status">Status</label>
            <select
              id="dj-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="open">Open</option>
              <option value="all">All</option>
              {(Object.keys(DISPATCH_STATUS_LABELS) as DispatchStatus[]).map((s) => (
                <option key={s} value={s}>
                  {DISPATCH_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-actions">
            <label>&nbsp;</label>
            <button type="button" className="btn" disabled={loading} onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </div>
          <div className="field field-actions">
            <label>&nbsp;</label>
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? "Hide form" : "New job"}
            </button>
          </div>
        </section>

        {(bootError || error) && (
          <p className="muted" role="alert" style={{ color: "var(--danger, #b42318)" }}>
            {error || bootError}
          </p>
        )}

        {showCreate && (
          <section className="panel dispatch-create">
            <h2>New job</h2>
            <div className="dispatch-create-grid">
              <label className="field">
                Title
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Delivery / pickup" />
              </label>
              <label className="field">
                Assign to
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Unassigned (draft)</option>
                  {fieldUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName || u.username}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Group (optional vehicle)
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
              <label className="field dispatch-create-span">
                Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </label>
              <label className="field dispatch-create-span">
                Stops (one per line: lat, lon Name)
                <textarea
                  value={stopPaste}
                  onChange={(e) => setStopPaste(e.target.value)}
                  rows={4}
                  placeholder={"-6.2, 106.8 Depot\n-6.3, 106.9 Customer"}
                />
              </label>
            </div>
            <div className="dispatch-create-actions">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void handleCreate()}>
                Create job
              </button>
            </div>
          </section>
        )}

        <div className="dispatch-layout">
          <section className="panel">
            <h2>Jobs</h2>
            {loading && jobs.length === 0 ? <p className="muted">Loading…</p> : null}
            {!loading && jobs.length === 0 ? <p className="muted">No jobs for this filter.</p> : null}
            <ul className="dispatch-job-list">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    className={`dispatch-job-row${selectedId === job.id ? " is-active" : ""}`}
                    onClick={() => setSelectedId(job.id)}
                  >
                    <span className={`dispatch-status dispatch-status-${job.status}`}>
                      {DISPATCH_STATUS_LABELS[job.status]}
                    </span>
                    <strong>{job.title}</strong>
                    <span className="muted">
                      {dispatchAssigneeLabel(job)} · {dispatchVehicleLabel(job)} · {job.stops.length} stop
                      {job.stops.length === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            {!selected ? (
              <>
                <h2>Detail</h2>
                <p className="muted">Select a job to assign, change status, or review stops.</p>
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
                  Vehicle · {dispatchVehicleLabel(selected)}
                  {selected.notes ? ` · ${selected.notes}` : ""}
                </p>
                {selected.fieldNote ? <p className="dispatch-field-note">Field note · {selected.fieldNote}</p> : null}

                <div className="dispatch-detail-actions">
                  <label className="field">
                    Assignee
                    <select
                      value={selected.assignedFieldUserId || ""}
                      disabled={busy || selected.status === "done" || selected.status === "cancelled"}
                      onChange={(e) =>
                        void updateJob(selected.id, {
                          assignedFieldUserId: e.target.value || null,
                        })
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

                <h3>Stops</h3>
                {selected.stops.length === 0 ? (
                  <p className="muted">No stops on this job.</p>
                ) : (
                  <ol className="dispatch-stop-list">
                    {selected.stops.map((stop, i) => (
                      <li key={stop.id}>
                        <strong>
                          {i + 1}. {stop.name}
                        </strong>
                        <span className="muted">
                          {stop.status}
                          {stop.lat != null && stop.lon != null ? ` · ${stop.lat.toFixed(4)}, ${stop.lon.toFixed(4)}` : ""}
                        </span>
                        {stop.lat != null && stop.lon != null ? (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lon}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Map
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
