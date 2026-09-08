import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { BrandMark } from "../components/BrandMark";
import { CatalogLineEditor } from "../components/CatalogLineEditor";
import { prepareImageDataUrl } from "../lib/imageUpload";
import {
  emptyLine,
  eventVehicleLabel,
  SERVICE_STATUS_LABELS,
  type CatalogGroup,
  type FieldUserOption,
  type ServiceEvent,
  type ServiceEventStatus,
  type ServiceLine,
  type ServicePhoto,
} from "../lib/maintenance";
import { fieldHref } from "../lib/routing";

type ManagerUser = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  tenantKey: string;
  appId: number;
};

type JobFilter = "all" | "open" | "awaiting" | "approved";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function isOpenStatus(status: string) {
  return status === "due" || status === "in_progress";
}

function formatJobDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function jobDateLabel(job: ServiceEvent): { label: string; value: string } {
  if (job.status === "done" || job.status === "approved" || job.status === "skipped") {
    return {
      label: job.status === "skipped" ? "Skipped" : job.status === "approved" ? "Approved" : "Done",
      value: formatJobDate(job.endedAt || job.approvedAt || job.updatedAt),
    };
  }
  return {
    label: "Due",
    value: job.remindDueAt ? formatJobDate(job.remindDueAt) : "No due date",
  };
}

function linesFromEvent(ev: ServiceEvent | null): ServiceLine[] {
  return ev?.lines?.length ? ev.lines.map((l) => ({ ...l })) : [emptyLine()];
}

export default function ManagerMaintenance() {
  const [user, setUser] = useState<ManagerUser | null>(null);
  const [managerMaintenance, setManagerMaintenance] = useState(false);
  const [tenantKey, setTenantKey] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get("k") || "";
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<ServiceEvent[]>([]);
  const [fieldUsers, setFieldUsers] = useState<FieldUserOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceEvent | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [notes, setNotes] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [assignId, setAssignId] = useState("");
  const [lines, setLines] = useState<ServiceLine[]>([emptyLine()]);
  const [linesDirty, setLinesDirty] = useState(false);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<{
        user: ManagerUser;
        managerMaintenance?: boolean;
      }>("/api/field/me");
      if (me.user.role !== "manager") {
        setUser(null);
        setManagerMaintenance(false);
        setError("This login is not a manager. Technicians use /m.");
        return false;
      }
      setUser(me.user);
      setManagerMaintenance(Boolean(me.managerMaintenance));
      setError("");
      return true;
    } catch {
      setUser(null);
      setManagerMaintenance(false);
      return false;
    }
  }, []);

  const loadJobs = useCallback(async () => {
    if (!managerMaintenance) {
      setJobs([]);
      return;
    }
    setLoadingJobs(true);
    setError("");
    try {
      const data = await api<{ events: ServiceEvent[] }>("/api/manager/maintenance/events?status=all");
      setJobs(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }, [managerMaintenance]);

  useEffect(() => {
    document.title = "Manager · FM Plus";
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (user && managerMaintenance) void loadJobs();
  }, [user, managerMaintenance, loadJobs]);

  useEffect(() => {
    if (!user || !managerMaintenance) {
      setFieldUsers([]);
      setCatalog([]);
      return;
    }
    let cancelled = false;
    void Promise.all([
      api<{ users: FieldUserOption[] }>("/api/manager/maintenance/field-users"),
      api<{ groups: CatalogGroup[] }>("/api/manager/maintenance/catalog"),
    ])
      .then(([usersData, catalogData]) => {
        if (cancelled) return;
        setFieldUsers(usersData.users || []);
        setCatalog(catalogData.groups || []);
      })
      .catch(() => {
        if (!cancelled) {
          setFieldUsers([]);
          setCatalog([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, managerMaintenance]);

  useEffect(() => {
    if (!selectedId || !managerMaintenance) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setNotice("");
    void api<{ event: ServiceEvent }>(`/api/manager/maintenance/events/${selectedId}`)
      .then((data) => {
        if (cancelled) return;
        const ev = data.event;
        setDetail(ev);
        setNotes(ev.notes || "");
        setOdometerKm(ev.odometerKm != null ? String(ev.odometerKm) : "");
        setAssignId(ev.assignedFieldUserId || "");
        setLines(linesFromEvent(ev));
        setLinesDirty(false);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, managerMaintenance]);

  const counts = useMemo(() => {
    let open = 0;
    let awaiting = 0;
    let approved = 0;
    for (const j of jobs) {
      if (isOpenStatus(j.status)) open += 1;
      else if (j.status === "done") awaiting += 1;
      else if (j.status === "approved") approved += 1;
    }
    return { open, awaiting, approved, all: jobs.length };
  }, [jobs]);

  const visibleJobs = useMemo(() => {
    if (jobFilter === "open") return jobs.filter((j) => isOpenStatus(j.status));
    if (jobFilter === "awaiting") return jobs.filter((j) => j.status === "done");
    if (jobFilter === "approved") return jobs.filter((j) => j.status === "approved");
    return jobs;
  }, [jobs, jobFilter]);

  const locked = detail?.status === "approved";

  const assigneeLabel = useCallback(
    (id: string | null | undefined) => {
      if (!id) return "Unassigned";
      const u = fieldUsers.find((f) => f.id === id);
      return u?.displayName || u?.username || "Assigned";
    },
    [fieldUsers],
  );

  function updateLine(idx: number, patch: Partial<ServiceLine>) {
    setLinesDirty(true);
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLinesDirty(true);
    setLines((prev) => (prev.length <= 1 ? [emptyLine()] : prev.filter((_, i) => i !== idx)));
  }

  function serializeLines() {
    return lines
      .filter(
        (l) =>
          l.description.trim() ||
          l.unitPrice != null ||
          l.unitCost != null ||
          String(l.vendor || "").trim(),
      )
      .map((l, i) => ({
        kind: l.kind === "labor" ? "service" : l.kind,
        catalogItemId: l.catalogItemId || null,
        description: l.description,
        qty: Number(l.qty) || 1,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        vendor: l.vendor,
        sortOrder: i,
      }));
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api<{
        user: ManagerUser;
        managerMaintenance?: boolean;
      }>("/api/field/login", {
        method: "POST",
        body: JSON.stringify({ tenantKey: tenantKey.trim(), username, password }),
      });
      setPassword("");
      if (data.user.role !== "manager") {
        await api("/api/field/logout", { method: "POST", body: "{}" });
        setUser(null);
        setError("This account is not a manager. Technicians sign in at /m.");
        return;
      }
      setUser(data.user);
      setManagerMaintenance(Boolean(data.managerMaintenance));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await api("/api/field/logout", { method: "POST", body: "{}" });
      setUser(null);
      setJobs([]);
      setSelectedId(null);
      setDetail(null);
      setManagerMaintenance(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveJob(extra: Record<string, unknown> = {}) {
    if (!selectedId || locked) return null;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = {
        notes: notes.trim(),
        odometerKm: odometerKm.trim() === "" ? null : Number(odometerKm),
        assignedFieldUserId: assignId || null,
        ...extra,
      };
      if (linesDirty) body.lines = serializeLines();
      const data = await api<{ event: ServiceEvent }>(`/api/manager/maintenance/events/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setDetail(data.event);
      setNotes(data.event.notes || "");
      setOdometerKm(data.event.odometerKm != null ? String(data.event.odometerKm) : "");
      setAssignId(data.event.assignedFieldUserId || "");
      setLines(linesFromEvent(data.event));
      setLinesDirty(false);
      setJobs((prev) => prev.map((j) => (j.id === data.event.id ? { ...j, ...data.event } : j)));
      if (extra.status === "approved") {
        setNotice("Job approved and locked.");
      } else {
        setNotice("Saved.");
      }
      void loadJobs();
      return data.event;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function endSeries() {
    if (!selectedId) return;
    if (
      !window.confirm(
        "End this series? Open jobs in the chain will be skipped and intervals cleared. Past Done/Approved stay.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ count: number }>(
        `/api/manager/maintenance/events/${selectedId}/end-series`,
        { method: "POST", body: JSON.stringify({ reason: "Series stopped" }) },
      );
      setNotice(
        result.count
          ? `Ended ${result.count} open job${result.count === 1 ? "" : "s"}.`
          : "No open jobs in this series.",
      );
      await loadJobs();
      const refreshed = await api<{ event: ServiceEvent }>(
        `/api/manager/maintenance/events/${selectedId}`,
      );
      setDetail(refreshed.event);
      setNotes(refreshed.event.notes || "");
      setOdometerKm(refreshed.event.odometerKm != null ? String(refreshed.event.odometerKm) : "");
      setAssignId(refreshed.event.assignedFieldUserId || "");
      setLines(linesFromEvent(refreshed.event));
    } catch (err) {
      setError(err instanceof Error ? err.message : "End series failed");
    } finally {
      setBusy(false);
    }
  }

  async function endVehicleOpen() {
    if (!detail?.armadaUserId) return;
    if (
      !window.confirm(
        `Stop all open maintenance for ${eventVehicleLabel(detail)}? Every due / in-progress job will be skipped.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ count: number }>(
        `/api/manager/maintenance/vehicles/${detail.armadaUserId}/end-open`,
        { method: "POST", body: JSON.stringify({ reason: "Vehicle maintenance stopped" }) },
      );
      setNotice(
        result.count
          ? `Stopped ${result.count} open job${result.count === 1 ? "" : "s"} for this vehicle.`
          : "No open jobs on this vehicle.",
      );
      await loadJobs();
      if (selectedId) {
        const refreshed = await api<{ event: ServiceEvent }>(
          `/api/manager/maintenance/events/${selectedId}`,
        );
        setDetail(refreshed.event);
        setNotes(refreshed.event.notes || "");
        setOdometerKm(refreshed.event.odometerKm != null ? String(refreshed.event.odometerKm) : "");
        setAssignId(refreshed.event.assignedFieldUserId || "");
        setLines(linesFromEvent(refreshed.event));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stop open failed");
    } finally {
      setBusy(false);
    }
  }

  function goBackToJobs() {
    setSelectedId(null);
    setDetail(null);
    setError("");
    setNotice("");
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId || locked) return;
    setBusy(true);
    setError("");
    try {
      const saved = await saveJob();
      if (!saved) return;
      setBusy(true);
      setNotice("Uploading photo…");
      const dataUrl = await prepareImageDataUrl(file);
      await api<{ photo: ServicePhoto }>(`/api/manager/maintenance/events/${selectedId}/photos`, {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      const refreshed = await api<{ event: ServiceEvent }>(
        `/api/manager/maintenance/events/${selectedId}`,
      );
      setDetail(refreshed.event);
      setLines(linesFromEvent(refreshed.event));
      setLinesDirty(false);
      setNotice("Photo uploaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="field-app">
        <header className="field-topbar">
          <div className="field-brand">
            <BrandMark size={20} />
            <div>
              <p className="field-kicker">FM Plus Manager</p>
              <h1>Maintenance</h1>
            </div>
          </div>
          <div className="field-topbar-meta">
            <span className="field-user-chip">{user.displayName || user.username}</span>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void handleLogout()}>
              Sign out
            </button>
          </div>
        </header>

        {(error || notice) && (
          <div className="field-banner">
            {error ? <p className="field-error">{error}</p> : null}
            {notice && !error ? <p className="field-notice">{notice}</p> : null}
          </div>
        )}

        {!managerMaintenance ? (
          <div className="field-panel" style={{ margin: "12px" }}>
            <h2>Manager PWA not enabled</h2>
            <p className="muted">
              Ask an admin to enable <strong>Mobile apps → Manager Maintenance PWA</strong> for tenant{" "}
              <code>{user.tenantKey}</code>.
            </p>
          </div>
        ) : selectedId && detail ? (
          <div className="field-job-detail">
            <button type="button" className="btn-ghost field-back" onClick={goBackToJobs}>
              ← Jobs
            </button>

            <section className="field-panel field-job-hero">
              <div className="field-job-hero-top">
                <span className={`field-status field-status-${detail.status}`}>
                  {SERVICE_STATUS_LABELS[detail.status as ServiceEventStatus]}
                </span>
                {!detail.assignedFieldUserId ? (
                  <span className="field-pill">Needs assign</span>
                ) : (
                  <span className="field-pill">{assigneeLabel(detail.assignedFieldUserId)}</span>
                )}
              </div>
              <h2>{detail.title}</h2>
              <p className="field-vehicle">{eventVehicleLabel(detail)}</p>
              <p className="field-detail-date muted">
                {(() => {
                  const d = jobDateLabel(detail);
                  return `${d.label} · ${d.value}`;
                })()}
              </p>
              {locked ? <p className="muted">Approved — locked for edits.</p> : null}
            </section>

            <section className="field-panel">
              <header className="field-panel-head">
                <h3>Assign technician</h3>
              </header>
              <label className="field-label">
                Field user
                <select
                  value={assignId}
                  disabled={locked || busy}
                  onChange={(e) => setAssignId(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {fieldUsers
                    .filter((u) => u.enabled)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName || u.username} ({u.role})
                      </option>
                    ))}
                </select>
              </label>
            </section>

            <section className="field-panel">
              <header className="field-panel-head">
                <h3>Job notes</h3>
              </header>
              <label className="field-label">
                Notes
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  disabled={locked || busy}
                  readOnly={locked}
                />
              </label>
              <label className="field-label">
                Odometer (km)
                <input
                  type="number"
                  inputMode="decimal"
                  value={odometerKm}
                  onChange={(e) => setOdometerKm(e.target.value)}
                  disabled={locked || busy}
                  readOnly={locked}
                />
              </label>
            </section>

            <section className="field-panel field-photos-panel">
              <header className="field-panel-head">
                <h3>Proof photos</h3>
              </header>
              {!locked ? (
                <label className="field-photo-btn">
                  Take / upload photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    onChange={(e) => void onPhoto(e)}
                  />
                </label>
              ) : null}
              {(detail.photos || []).length > 0 ? (
                <ul className="field-photo-grid">
                  {(detail.photos || []).map((p) => (
                    <li key={p.id}>
                      <img src={p.url} alt={p.caption || "PoM"} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No photos yet.</p>
              )}
            </section>

            <section className="field-panel">
              <header className="field-panel-head">
                <h3>Parts &amp; service</h3>
              </header>
              <div className="field-lines">
                {lines.map((line, idx) => (
                  <CatalogLineEditor
                    key={idx}
                    line={line}
                    catalog={catalog}
                    compact
                    disabled={locked || busy}
                    onChange={(patch) => updateLine(idx, patch)}
                    onRemove={() => removeLine(idx)}
                  />
                ))}
              </div>
              {!locked ? (
                <div className="field-lines-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setLinesDirty(true);
                      setLines((p) => [...p, emptyLine()]);
                    }}
                  >
                    Add line
                  </button>
                </div>
              ) : null}
            </section>

            {!locked ? (
              <div className="field-job-actions">
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void saveJob()}>
                  Save
                </button>
                {detail.status === "done" ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void saveJob({ status: "approved" })}
                  >
                    Approve
                  </button>
                ) : null}
                {detail.status === "due" ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void saveJob({ status: "in_progress" })}
                  >
                    Start
                  </button>
                ) : null}
                {detail.status === "in_progress" ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void saveJob({ status: "done" })}
                  >
                    Done
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="field-job-actions">
              {(detail.status === "due" ||
                detail.status === "in_progress" ||
                detail.status === "done" ||
                detail.status === "approved" ||
                detail.status === "skipped" ||
                Boolean(detail.parentEventId)) && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void endSeries()}
                >
                  End series
                </button>
              )}
              {detail.armadaUserId != null ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void endVehicleOpen()}
                >
                  Stop all open
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="field-jobs">
            <div className="field-jobs-toolbar">
              <div className="field-job-filters" role="tablist" aria-label="Job filters">
                {(
                  [
                    ["all", "All", counts.all],
                    ["open", "Open", counts.open],
                    ["awaiting", "Approve", counts.awaiting],
                    ["approved", "Approved", counts.approved],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={jobFilter === key}
                    className={`field-filter-chip${jobFilter === key ? " is-active" : ""}`}
                    onClick={() => setJobFilter(key)}
                  >
                    {label}
                    <span className="field-filter-count">{count}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-ghost field-refresh-btn"
                disabled={loadingJobs}
                onClick={() => void loadJobs()}
              >
                {loadingJobs ? "…" : "Refresh"}
              </button>
            </div>

            {loadingJobs && jobs.length === 0 && <p className="muted field-loading">Loading jobs…</p>}

            {!loadingJobs && visibleJobs.length === 0 && (
              <div className="field-panel field-empty">
                <h2>No jobs here</h2>
                <p className="muted">Open jobs, assign technicians, and Approve completed work.</p>
              </div>
            )}

            <ul className="field-job-list">
              {visibleJobs.map((job) => {
                const date = jobDateLabel(job);
                return (
                  <li key={job.id}>
                    <button type="button" className="field-job-row" onClick={() => setSelectedId(job.id)}>
                      <span className={`field-row-rail field-status-${job.status}`} aria-hidden />
                      <span className="field-job-row-main">
                        <span className="field-job-row-top">
                          <strong>{job.title}</strong>
                          <span className="field-job-date">{date.value}</span>
                        </span>
                        <span className="field-job-row-meta muted">
                          <span className={`field-status-dot field-status-${job.status}`} />
                          {SERVICE_STATUS_LABELS[job.status]} · {eventVehicleLabel(job)}
                          {" · "}
                          {assigneeLabel(job.assignedFieldUserId)}
                        </span>
                      </span>
                      <span className="field-job-chevron" aria-hidden>
                        ›
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="field-app field-app-login">
      <div className="field-login-shell auth-login-shell">
        <div className="field-login-brand auth-login-brand">
          <div className="auth-login-brand-top">
            <BrandMark size={28} />
            <p className="field-kicker">ARMADA M.1</p>
          </div>
          <div className="auth-login-brand-copy">
            <h1>Manager</h1>
            <p className="muted">
              Assign technicians, review completed jobs, and Approve work on the go.
            </p>
          </div>
          <ul className="auth-login-points" aria-hidden="true">
            <li>Open &amp; unassigned jobs</li>
            <li>Assign field users</li>
            <li>Approve Done jobs</li>
          </ul>
        </div>
        <form className="field-login-form auth-login-form" onSubmit={(e) => void handleLogin(e)}>
          <header className="auth-login-form-head">
            <h2>Sign in</h2>
            <p className="muted">
              Manager role required · technicians use{" "}
              <a href={fieldHref(tenantKey ? `?k=${encodeURIComponent(tenantKey)}` : "")}>/m</a>
            </p>
          </header>
          {error && <p className="field-error">{error}</p>}
          <label className="field-label">
            Tenant key (k)
            <input value={tenantKey} onChange={(e) => setTenantKey(e.target.value)} autoComplete="organization" />
          </label>
          <label className="field-label">
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="field-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="btn btn-primary auth-login-submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
