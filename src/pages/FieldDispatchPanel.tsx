import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DISPATCH_STATUS_LABELS,
  dispatchVehicleLabel,
  type DispatchJob,
  type DispatchStatus,
  type DispatchStop,
} from "../lib/dispatch";

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

type Props = {
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
};

export function FieldDispatchPanel({ onError, onNotice }: Props) {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fieldNote, setFieldNote] = useState("");
  const onErrorRef = useRef(onError);
  const onNoticeRef = useRef(onNotice);
  onErrorRef.current = onError;
  onNoticeRef.current = onNotice;

  const selected = useMemo(
    () => jobs.find((j) => j.id === selectedId) || null,
    [jobs, selectedId],
  );

  const openJobs = useMemo(
    () => jobs.filter((j) => j.status === "assigned" || j.status === "en_route" || j.status === "arrived"),
    [jobs],
  );
  const closedJobs = useMemo(
    () => jobs.filter((j) => j.status === "done" || j.status === "cancelled"),
    [jobs],
  );

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ jobs: DispatchJob[] }>("/api/field/dispatch/jobs");
      setJobs(data.jobs || []);
      onErrorRef.current("");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Could not load dispatch jobs");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!selected) {
      setFieldNote("");
      return;
    }
    setFieldNote(selected.fieldNote || "");
  }, [selected?.id, selected?.fieldNote]);

  async function patchJob(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const data = await api<{ job: DispatchJob }>(`/api/field/dispatch/jobs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setJobs((prev) => prev.map((j) => (j.id === data.job.id ? data.job : j)));
      onErrorRef.current("");
      return data.job;
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Update failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function patchStop(jobId: string, stopId: string, status: string) {
    setBusy(true);
    try {
      const data = await api<{ job: DispatchJob; stop: DispatchStop }>(
        `/api/field/dispatch/jobs/${jobId}/stops/${stopId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      );
      setJobs((prev) => prev.map((j) => (j.id === data.job.id ? data.job : j)));
      onErrorRef.current("");
      onNoticeRef.current(`Stop marked ${status}`);
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Stop update failed");
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    const locked = selected.status === "done" || selected.status === "cancelled";
    return (
      <div className="field-job-detail">
        <button
          type="button"
          className="btn-ghost field-back"
            onClick={() => {
            setSelectedId(null);
            onNoticeRef.current("");
            onErrorRef.current("");
          }}
        >
          ← Jobs
        </button>

        <section className="field-panel field-job-hero">
          <div className="field-job-hero-top">
            <span className={`field-status dispatch-status-${selected.status}`}>
              {DISPATCH_STATUS_LABELS[selected.status as DispatchStatus]}
            </span>
          </div>
          <h2>{selected.title}</h2>
          <p className="field-vehicle">{dispatchVehicleLabel(selected)}</p>
          {selected.notes ? <p className="muted">{selected.notes}</p> : null}
          <ol className="field-flow-steps">
            <li className={selected.status !== "assigned" ? "is-done" : "is-current"}>1. Start</li>
            <li
              className={
                selected.status === "en_route" || selected.status === "arrived"
                  ? "is-current"
                  : selected.status === "done"
                    ? "is-done"
                    : ""
              }
            >
              2. Stops
            </li>
            <li className={selected.status === "done" ? "is-done" : selected.status === "arrived" ? "is-current" : ""}>
              3. Done
            </li>
          </ol>
        </section>

        <section className="field-panel">
          <header className="field-panel-head">
            <h3>Status</h3>
          </header>
          <div className="field-action-row">
            {selected.status === "assigned" ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || locked}
                onClick={() => void patchJob(selected.id, { status: "en_route" }).then((j) => j && onNoticeRef.current("En route"))}
              >
                Start / En route
              </button>
            ) : null}
            {selected.status === "en_route" ? (
              <button
                type="button"
                className="btn"
                disabled={busy || locked}
                onClick={() => void patchJob(selected.id, { status: "arrived" }).then((j) => j && onNoticeRef.current("Arrived"))}
              >
                Mark arrived
              </button>
            ) : null}
            {!locked && selected.status !== "assigned" ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  void patchJob(selected.id, { status: "done", fieldNote }).then((j) => {
                    if (!j) return;
                    onNoticeRef.current("Job completed");
                    setSelectedId(null);
                    void loadJobs();
                  })
                }
              >
                Complete job
              </button>
            ) : null}
          </div>
        </section>

        <section className="field-panel">
          <header className="field-panel-head">
            <h3>Field note</h3>
          </header>
          <label className="field-label">
            Note
            <textarea
              value={fieldNote}
              onChange={(e) => setFieldNote(e.target.value)}
              rows={3}
              disabled={locked || busy}
              readOnly={locked}
            />
          </label>
          {!locked ? (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                void patchJob(selected.id, { fieldNote }).then((j) => j && onNoticeRef.current("Note saved"))
              }
            >
              Save note
            </button>
          ) : null}
        </section>

        <section className="field-panel">
          <header className="field-panel-head">
            <h3>Stops</h3>
          </header>
          {selected.stops.length === 0 ? (
            <p className="muted">No stops on this job.</p>
          ) : (
            <ul className="field-dispatch-stops">
              {selected.stops.map((stop, i) => (
                <li key={stop.id} className="field-dispatch-stop">
                  <div>
                    <strong>
                      {i + 1}. {stop.name}
                    </strong>
                    <span className="muted"> · {stop.status}</span>
                    {stop.lat != null && stop.lon != null ? (
                      <div>
                        <a
                          className="field-map-link"
                          href={`https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lon}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open map
                        </a>
                      </div>
                    ) : null}
                  </div>
                  {!locked && stop.status !== "done" && stop.status !== "skipped" ? (
                    <div className="field-dispatch-stop-actions">
                      {stop.status === "pending" ? (
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => void patchStop(selected.id, stop.id, "arrived")}
                        >
                          Arrived
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void patchStop(selected.id, stop.id, "done")}
                      >
                        Done
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => void patchStop(selected.id, stop.id, "skipped")}
                      >
                        Skip
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="field-jobs">
      <div className="field-jobs-toolbar">
        <p className="muted" style={{ margin: 0 }}>
          {openJobs.length} open · {closedJobs.length} recent closed
        </p>
        <button type="button" className="btn-ghost field-refresh-btn" disabled={loading} onClick={() => void loadJobs()}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {loading && jobs.length === 0 ? <p className="muted field-loading">Loading dispatch…</p> : null}

      {!loading && jobs.length === 0 ? (
        <div className="field-panel field-empty">
          <h2>No dispatch jobs</h2>
          <p className="muted">Desk assigns work from Jobs (/jobs). You only see jobs assigned to your login.</p>
        </div>
      ) : null}

      {openJobs.length > 0 ? (
        <section className="field-jobs-section">
          <h2 className="field-jobs-section-title">Open</h2>
          <ul className="field-job-list">
            {openJobs.map((job) => (
              <li key={job.id}>
                <button type="button" className="field-job-row" onClick={() => setSelectedId(job.id)}>
                  <span className={`field-row-rail dispatch-status-${job.status}`} aria-hidden />
                  <span className="field-job-row-main">
                    <span className="field-job-row-top">
                      <strong>{job.title}</strong>
                      <span className="field-job-date">{DISPATCH_STATUS_LABELS[job.status]}</span>
                    </span>
                    <span className="field-job-row-meta muted">
                      {dispatchVehicleLabel(job)} · {job.stops.length} stop{job.stops.length === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {closedJobs.length > 0 ? (
        <section className="field-jobs-section">
          <h2 className="field-jobs-section-title">Recent</h2>
          <ul className="field-job-list">
            {closedJobs.map((job) => (
              <li key={job.id}>
                <button type="button" className="field-job-row" onClick={() => setSelectedId(job.id)}>
                  <span className={`field-row-rail dispatch-status-${job.status}`} aria-hidden />
                  <span className="field-job-row-main">
                    <span className="field-job-row-top">
                      <strong>{job.title}</strong>
                      <span className="field-job-date">{DISPATCH_STATUS_LABELS[job.status]}</span>
                    </span>
                    <span className="field-job-row-meta muted">{dispatchVehicleLabel(job)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
