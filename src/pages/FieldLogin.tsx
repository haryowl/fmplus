import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { BrandMark } from "../components/BrandMark";
import { prepareImageDataUrl } from "../lib/imageUpload";
import {
  emptyLine,
  eventVehicleLabel,
  LINE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  type LineKind,
  type ServiceEvent,
  type ServiceEventStatus,
  type ServiceLine,
  type ServicePhoto,
} from "../lib/maintenance";

type FieldUser = {
  id: string;
  username: string;
  role: string;
  displayName: string;
  tenantKey: string;
  appId: number;
};

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

function draftKey(eventId: string) {
  return `fmplus-field-draft:${eventId}`;
}

function loadDraft(eventId: string): { notes?: string; odometerKm?: string; lines?: ServiceLine[] } | null {
  try {
    const raw = localStorage.getItem(draftKey(eventId));
    if (!raw) return null;
    return JSON.parse(raw) as { notes?: string; odometerKm?: string; lines?: ServiceLine[] };
  } catch {
    return null;
  }
}

function saveDraft(eventId: string, draft: { notes: string; odometerKm: string; lines: ServiceLine[] }) {
  try {
    localStorage.setItem(draftKey(eventId), JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

function clearDraft(eventId: string) {
  try {
    localStorage.removeItem(draftKey(eventId));
  } catch {
    /* ignore */
  }
}

function linesFromEvent(ev: ServiceEvent | null): ServiceLine[] {
  const list = ev?.lines?.length ? ev.lines.map((l) => ({ ...l })) : [emptyLine()];
  return list;
}

export default function FieldLogin() {
  const [user, setUser] = useState<FieldUser | null>(null);
  const [mobileMaintenance, setMobileMaintenance] = useState(false);
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceEvent | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [notes, setNotes] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [lines, setLines] = useState<ServiceLine[]>([emptyLine()]);
  const [linesDirty, setLinesDirty] = useState(false);
  const [jobFilter, setJobFilter] = useState<"all" | "due" | "in_progress">("all");

  const refreshMe = useCallback(async () => {
    try {
      const me = await api<{ user: FieldUser; mobileMaintenance?: boolean }>("/api/field/me");
      setUser(me.user);
      setMobileMaintenance(Boolean(me.mobileMaintenance));
      return true;
    } catch {
      setUser(null);
      setMobileMaintenance(false);
      return false;
    }
  }, []);

  const loadJobs = useCallback(async () => {
    if (!mobileMaintenance) {
      setJobs([]);
      return;
    }
    setLoadingJobs(true);
    setError("");
    try {
      const data = await api<{ events: ServiceEvent[] }>("/api/field/maintenance/events");
      setJobs(data.events || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load jobs");
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }, [mobileMaintenance]);

  useEffect(() => {
    document.title = "Field · FM Plus";
    void refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    if (user && mobileMaintenance) void loadJobs();
  }, [user, mobileMaintenance, loadJobs]);

  useEffect(() => {
    if (!selectedId || !mobileMaintenance) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setNotice("");
    void api<{ event: ServiceEvent }>(`/api/field/maintenance/events/${selectedId}`)
      .then((data) => {
        if (cancelled) return;
        const ev = data.event;
        const draft = loadDraft(selectedId);
        setDetail(ev);
        const serverLines = linesFromEvent(ev);
        const draftHasLines = Boolean(
          draft?.lines?.some(
            (l) =>
              String(l.description || "").trim() ||
              l.unitPrice != null ||
              l.unitCost != null ||
              String(l.vendor || "").trim(),
          ),
        );
        const serverHasLines = Boolean(ev.lines?.length);
        setNotes(draft?.notes != null && draft.notes !== (ev.notes || "") ? draft.notes : ev.notes || "");
        setOdometerKm(
          draft?.odometerKm != null &&
            draft.odometerKm !== (ev.odometerKm != null ? String(ev.odometerKm) : "")
            ? draft.odometerKm
            : ev.odometerKm != null
              ? String(ev.odometerKm)
              : "",
        );
        if (!serverHasLines && draftHasLines && draft?.lines) {
          setLines(draft.lines.map((l) => ({ ...l })));
          setLinesDirty(true);
          setNotice("Restored unsaved parts draft on this device.");
        } else {
          setLines(serverLines);
          setLinesDirty(false);
        }
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
  }, [selectedId, mobileMaintenance]);

  useEffect(() => {
    if (!selectedId || !detail) return;
    saveDraft(selectedId, { notes, odometerKm, lines });
  }, [selectedId, detail, notes, odometerKm, lines]);

  const visibleJobs = useMemo(() => {
    if (jobFilter === "all") return jobs;
    return jobs.filter((j) => j.status === jobFilter);
  }, [jobs, jobFilter]);

  const priceTotal = lines.reduce((s, l) => {
    const p = l.unitPrice;
    return s + (p == null ? 0 : p * (Number(l.qty) || 0));
  }, 0);
  const costTotal = lines.reduce((s, l) => {
    const c = l.unitCost;
    return s + (c == null ? 0 : c * (Number(l.qty) || 0));
  }, 0);

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
        kind: l.kind,
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
      const data = await api<{ user: FieldUser; mobileMaintenance?: boolean }>("/api/field/login", {
        method: "POST",
        body: JSON.stringify({ tenantKey: tenantKey.trim(), username, password }),
      });
      setPassword("");
      setUser(data.user);
      setMobileMaintenance(Boolean(data.mobileMaintenance));
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
      setMobileMaintenance(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveJob(extra: Record<string, unknown> = {}, opts: { quiet?: boolean } = {}) {
    if (!selectedId) return null;
    setBusy(true);
    setError("");
    if (!opts.quiet) setNotice("");
    try {
      const body: Record<string, unknown> = {
        notes: notes.trim(),
        odometerKm: odometerKm.trim() === "" ? null : Number(odometerKm),
        ...extra,
      };
      // Only replace lines when the tech edited them — empty default row must not wipe DB lines.
      if (linesDirty || extra.status === "done" || extra.status === "skipped") {
        body.lines = serializeLines();
      }
      const data = await api<{ event: ServiceEvent; nextEvent?: ServiceEvent | null }>(
        `/api/field/maintenance/events/${selectedId}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      setDetail(data.event);
      setLines(linesFromEvent(data.event));
      setLinesDirty(false);
      clearDraft(selectedId);
      const status = String(extra.status || data.event.status);
      if (status === "done" || status === "skipped") {
        setSelectedId(null);
        setDetail(null);
        setNotice(status === "done" ? "Job completed. Service time recorded." : "Job skipped.");
        await loadJobs();
      } else if (status === "in_progress" && extra.status === "in_progress") {
        setJobs((prev) => prev.map((j) => (j.id === data.event.id ? { ...j, ...data.event } : j)));
        if (!opts.quiet) setNotice("Started — clock is running. Save notes anytime, then Done.");
      } else if (extra.status === "due") {
        setJobs((prev) => prev.map((j) => (j.id === data.event.id ? { ...j, ...data.event } : j)));
        if (!opts.quiet) setNotice("Start cancelled. Press Start again when ready.");
      } else {
        setJobs((prev) => prev.map((j) => (j.id === data.event.id ? { ...j, ...data.event } : j)));
        if (!opts.quiet) setNotice("Saved.");
      }
      return data.event;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      // If Done already committed but the response failed, sync from server.
      if (selectedId && (extra.status === "done" || extra.status === "skipped" || extra.status === "in_progress")) {
        try {
          const refreshed = await api<{ event: ServiceEvent }>(
            `/api/field/maintenance/events/${selectedId}`,
          );
          setDetail(refreshed.event);
          setLines(linesFromEvent(refreshed.event));
          if (refreshed.event.status === "done" || refreshed.event.status === "skipped") {
            setSelectedId(null);
            setDetail(null);
            setNotice(
              refreshed.event.status === "done"
                ? "Job completed. Service time recorded."
                : "Job skipped.",
            );
            await loadJobs();
            return refreshed.event;
          }
          setJobs((prev) =>
            prev.map((j) => (j.id === refreshed.event.id ? { ...j, ...refreshed.event } : j)),
          );
        } catch {
          /* keep error */
        }
      }
      setError(msg);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function goBackToJobs() {
    if (selectedId && (linesDirty || notes.trim() || odometerKm.trim())) {
      const ok = await saveJob({}, { quiet: true });
      if (!ok) return;
    }
    setSelectedId(null);
    setDetail(null);
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId) return;
    setBusy(true);
    setError("");
    setNotice("Saving job sheet…");
    try {
      const saved = await saveJob({}, { quiet: true });
      if (!saved) return;
      setBusy(true);
      setNotice("Uploading photo…");
      const dataUrl = await prepareImageDataUrl(file);
      await api<{ photo: ServicePhoto }>(`/api/field/maintenance/events/${selectedId}/photos`, {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      const refreshed = await api<{ event: ServiceEvent }>(
        `/api/field/maintenance/events/${selectedId}`,
      );
      setDetail(refreshed.event);
      setLines(linesFromEvent(refreshed.event));
      setLinesDirty(false);
      clearDraft(selectedId);
      setNotice("Photo uploaded and saved.");
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
              <p className="field-kicker">FM Plus Field</p>
              <h1>My jobs</h1>
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

        {!mobileMaintenance ? (
          <div className="field-panel">
            <h2>PWA not enabled</h2>
            <p className="muted">
              Ask an admin to enable <strong>Mobile apps → Maintenance PWA</strong> for tenant{" "}
              <code>{user.tenantKey}</code>.
            </p>
          </div>
        ) : selectedId && detail ? (
          <div className="field-job-detail">
            <button type="button" className="btn-ghost field-back" onClick={() => void goBackToJobs()}>
              ← Jobs
            </button>

            <section className="field-panel field-job-hero">
              <div className="field-job-hero-top">
                <span className={`field-status field-status-${detail.status}`}>
                  {SERVICE_STATUS_LABELS[detail.status as ServiceEventStatus]}
                </span>
                {detail.assignedFieldUserId ? (
                  <span className="field-pill">Assigned to you</span>
                ) : null}
              </div>
              <h2>{detail.title}</h2>
              <p className="field-vehicle">{eventVehicleLabel(detail)}</p>
              <ol className="field-flow-steps">
                <li className={detail.status !== "due" ? "is-done" : "is-current"}>1. Start</li>
                <li
                  className={
                    detail.status === "in_progress"
                      ? "is-current"
                      : detail.status === "done" || detail.status === "skipped"
                        ? "is-done"
                        : ""
                  }
                >
                  2. Work + Save
                </li>
                <li className={detail.status === "done" ? "is-done" : detail.status === "in_progress" ? "is-current" : ""}>
                  3. Done
                </li>
              </ol>
              {detail.status === "due" ? (
                <p className="muted">Press <strong>Start</strong> before Done. Save only stores notes/parts.</p>
              ) : null}
              {detail.status === "in_progress" && detail.startedAt ? (
                <p className="field-service-clock muted">
                  Service clock running since {new Date(detail.startedAt).toLocaleString()}
                </p>
              ) : null}
              {detail.serviceDurationMinutes != null ? (
                <p className="field-service-clock">
                  Service time · {detail.serviceDurationMinutes} min
                </p>
              ) : null}
              {detail.servicePointName ? (
                <p className="muted">Service point · {detail.servicePointName}</p>
              ) : null}
              {detail.servicePointLat != null && detail.servicePointLon != null ? (
                <a
                  className="field-map-link"
                  href={`https://www.google.com/maps/search/?api=1&query=${detail.servicePointLat},${detail.servicePointLon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open map
                </a>
              ) : detail.lat != null && detail.lon != null ? (
                <a
                  className="field-map-link"
                  href={`https://www.google.com/maps/search/?api=1&query=${detail.lat},${detail.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Vehicle last fix
                </a>
              ) : null}
            </section>

            <section className="field-panel">
              <header className="field-panel-head">
                <h3>Job notes</h3>
              </header>
              <label className="field-label">
                Notes
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </label>
              <label className="field-label">
                Odometer (km)
                <input
                  type="number"
                  inputMode="decimal"
                  value={odometerKm}
                  onChange={(e) => setOdometerKm(e.target.value)}
                  placeholder="Optional"
                />
              </label>
            </section>

            <section className="field-panel field-photos-panel">
              <header className="field-panel-head">
                <h3>Proof photos</h3>
                <p className="muted">Take a picture — it saves with the job sheet</p>
              </header>
              <label className="field-photo-btn">
                Take / upload photo
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e)} />
              </label>
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
                <h3>Parts & labor</h3>
                <p className="muted">Add what you used or charged on this job</p>
              </header>
              <div className="field-lines">
                {lines.map((line, idx) => (
                  <article key={idx} className="field-line-card">
                    <div className="field-line-top">
                      <select
                        value={line.kind}
                        onChange={(e) => updateLine(idx, { kind: e.target.value as LineKind })}
                        aria-label="Line kind"
                      >
                        {(Object.keys(LINE_KIND_LABELS) as LineKind[]).map((k) => (
                          <option key={k} value={k}>
                            {LINE_KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-ghost btn-compact"
                        onClick={() => removeLine(idx)}
                        aria-label="Remove line"
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      placeholder="Description (part / work)"
                      value={line.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                    />
                    <div className="field-line-grid">
                      <label>
                        Qty
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          value={line.qty}
                          onChange={(e) => updateLine(idx, { qty: Number(e.target.value) || 0 })}
                        />
                      </label>
                      <label>
                        Unit price
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          placeholder="0"
                          value={line.unitPrice ?? ""}
                          onChange={(e) =>
                            updateLine(idx, {
                              unitPrice: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Unit cost
                        <input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          placeholder="0"
                          value={line.unitCost ?? ""}
                          onChange={(e) =>
                            updateLine(idx, {
                              unitCost: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Vendor
                        <input
                          value={line.vendor}
                          onChange={(e) => updateLine(idx, { vendor: e.target.value })}
                          placeholder="Optional"
                        />
                      </label>
                    </div>
                  </article>
                ))}
              </div>
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
                <span className="field-totals">
                  Price Σ {priceTotal.toFixed(2)}
                  <span>·</span>
                  Cost Σ {costTotal.toFixed(2)}
                </span>
              </div>
            </section>

            <div className="field-job-actions">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => void saveJob()}>
                Save
              </button>
              {detail.status === "due" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void saveJob({ status: "in_progress" })}
                >
                  Start
                </button>
              )}
              {detail.status === "in_progress" && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void saveJob({ status: "done" })}
                >
                  Done
                </button>
              )}
              {detail.status === "in_progress" && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void saveJob({ status: "due" })}
                >
                  Cancel start
                </button>
              )}
              {(detail.status === "due" || detail.status === "in_progress") && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void saveJob({ status: "skipped" })}
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="field-jobs">
            <div className="field-jobs-toolbar">
              <div className="field-job-filters">
                {(
                  [
                    ["all", "All"],
                    ["due", "Due"],
                    ["in_progress", "In progress"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`field-filter-chip${jobFilter === key ? " is-active" : ""}`}
                    onClick={() => setJobFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button type="button" className="btn-ghost" disabled={loadingJobs} onClick={() => void loadJobs()}>
                Refresh
              </button>
            </div>
            {loadingJobs && <p className="muted field-loading">Loading jobs…</p>}
            {!loadingJobs && visibleJobs.length === 0 && (
              <div className="field-panel field-empty">
                <h2>No jobs assigned to you</h2>
                <p className="muted">
                  A manager assigns work from Maintenance (desktop). You only see jobs assigned to your
                  login under this tenant.
                </p>
              </div>
            )}
            <ul className="field-job-list">
              {visibleJobs.map((job) => (
                <li key={job.id}>
                  <button type="button" className="field-job-row" onClick={() => setSelectedId(job.id)}>
                    <span className={`field-row-rail field-status-${job.status}`} aria-hidden />
                    <span className="field-job-row-main">
                      <strong>{job.title}</strong>
                      <span className="muted">
                        {SERVICE_STATUS_LABELS[job.status]} · {eventVehicleLabel(job)}
                      </span>
                    </span>
                    <span className="field-job-chevron" aria-hidden>
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="field-app field-app-login">
      <div className="field-login-shell">
        <div className="field-login-brand">
          <BrandMark size={28} />
          <div>
            <p className="field-kicker">FM Plus</p>
            <h1>Field</h1>
            <p className="muted">Jobs, parts, photos — assigned work for this tenant’s technicians and drivers.</p>
          </div>
        </div>
        <form className="field-login-form" onSubmit={(e) => void handleLogin(e)}>
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
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
