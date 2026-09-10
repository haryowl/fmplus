import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { prepareImageDataUrl } from "../lib/imageUpload";
import {
  DISPATCH_STATUS_LABELS,
  dispatchVehicleLabel,
  fieldStopPhotos,
  formatDispatchWindow,
  formatServiceDateLabel,
  mapsNavigateUrl,
  shiftServiceDate,
  todayServiceDate,
  uploadDispatchStopPhoto,
  type DispatchJob,
  type DispatchPhoto,
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

type Tab = "route" | "proof";

export function FieldDispatchPanel({ onError, onNotice }: Props) {
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState(todayServiceDate);
  const [fieldNote, setFieldNote] = useState("");
  const [tab, setTab] = useState<Tab>("route");
  const [photosByStop, setPhotosByStop] = useState<Record<string, DispatchPhoto[]>>({});
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

  const stopsLeft = useMemo(() => {
    if (!selected) return 0;
    return selected.stops.filter((s) => s.status !== "done" && s.status !== "skipped").length;
  }, [selected]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ jobs: DispatchJob[]; serviceDate?: string }>(
        `/api/field/dispatch/jobs?date=${encodeURIComponent(planDate)}`,
      );
      setJobs(data.jobs || []);
      onErrorRef.current("");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Could not load dispatch jobs");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [planDate]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    setSelectedId(null);
  }, [planDate]);

  useEffect(() => {
    if (!selected) {
      setFieldNote("");
      return;
    }
    setFieldNote(selected.fieldNote || "");
  }, [selected?.id, selected?.fieldNote]);

  useEffect(() => {
    if (!selected || tab !== "proof") return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, DispatchPhoto[]> = {};
      for (const stop of selected.stops) {
        try {
          next[stop.id] = await fieldStopPhotos(selected.id, stop.id);
        } catch {
          next[stop.id] = [];
        }
      }
      if (!cancelled) setPhotosByStop(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.stops, tab]);

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
      onNoticeRef.current(status === "done" ? "Stop completed" : `Stop marked ${status}`);
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Stop update failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(stopId: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected) return;
    setBusy(true);
    try {
      const dataUrl = await prepareImageDataUrl(file);
      const photo = await uploadDispatchStopPhoto(selected.id, stopId, dataUrl);
      setPhotosByStop((prev) => ({
        ...prev,
        [stopId]: [photo, ...(prev[stopId] || [])],
      }));
      onNoticeRef.current("POD photo saved");
      onErrorRef.current("");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (selected) {
    const locked = selected.status === "done" || selected.status === "cancelled";
    const nextStop = selected.stops.find((s) => s.status !== "done" && s.status !== "skipped");
    return (
      <div className="field-job-detail">
        <button
          type="button"
          className="btn-ghost field-back"
          onClick={() => {
            setSelectedId(null);
            setTab("route");
            onNoticeRef.current("");
            onErrorRef.current("");
          }}
        >
          ← Jobs
        </button>

        <section className="field-panel field-dispatch-capacity">
          <p className="field-kicker">CAPACITY TODAY</p>
          <p className="field-dispatch-cap-main">
            {selected.volumeUsed ?? 0} / {selected.volumeCapacityM3 ?? 12} m³ · {selected.utilizationPct ?? 0}%
          </p>
          <p className="muted">
            {stopsLeft} stop{stopsLeft === 1 ? "" : "s"} left · {dispatchVehicleLabel(selected)}
          </p>
        </section>

        <section className="field-panel field-job-hero">
          <div className="field-job-hero-top">
            <span className={`field-status dispatch-status-${selected.status}`}>
              {DISPATCH_STATUS_LABELS[selected.status as DispatchStatus]}
            </span>
          </div>
          <h2>{selected.title}</h2>
          {selected.serviceDate ? (
            <p className="muted">{formatServiceDateLabel(selected.serviceDate)}</p>
          ) : null}
          {selected.notes ? <p className="muted">{selected.notes}</p> : null}
        </section>

        <div className="field-mode-tabs" role="tablist" aria-label="Dispatch views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "route"}
            className={`field-filter-chip${tab === "route" ? " is-active" : ""}`}
            onClick={() => setTab("route")}
          >
            Route
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "proof"}
            className={`field-filter-chip${tab === "proof" ? " is-active" : ""}`}
            onClick={() => setTab("proof")}
          >
            Proof
          </button>
        </div>

        {tab === "route" ? (
          <>
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
                    onClick={() =>
                      void patchJob(selected.id, { status: "en_route" }).then(
                        (j) => j && onNoticeRef.current("En route"),
                      )
                    }
                  >
                    Start route
                  </button>
                ) : null}
                {!locked && selected.status !== "assigned" ? (
                  <button
                    type="button"
                    className="btn"
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
              <label className="field-label">
                Field note
                <textarea
                  value={fieldNote}
                  onChange={(e) => setFieldNote(e.target.value)}
                  rows={2}
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
                    void patchJob(selected.id, { fieldNote }).then(
                      (j) => j && onNoticeRef.current("Note saved"),
                    )
                  }
                >
                  Save note
                </button>
              ) : null}
            </section>

            <section className="field-panel">
              <header className="field-panel-head">
                <h3>Stops · {selected.stops.length}</h3>
              </header>
              {selected.stops.length === 0 ? (
                <p className="muted">No stops on this job.</p>
              ) : (
                <ul className="field-dispatch-stops">
                  {selected.stops.map((stop, i) => {
                    const isNext = nextStop?.id === stop.id;
                    const done = stop.status === "done" || stop.status === "skipped";
                    return (
                      <li key={stop.id} className={`field-dispatch-stop${isNext ? " is-next" : ""}`}>
                        <div>
                          <div className="field-dispatch-stop-top">
                            <span className="field-dispatch-stop-num">#{i + 1}</span>
                            {isNext ? <span className="field-pill">NEXT</span> : null}
                            <strong>{stop.name}</strong>
                          </div>
                          {formatDispatchWindow(stop) ? (
                            <p className="muted">⏱ {formatDispatchWindow(stop)}</p>
                          ) : null}
                          {stop.address ? <p className="muted">{stop.address}</p> : null}
                          <p className="muted">
                            {stop.zone ? `${stop.zone} · ` : ""}
                            {stop.volumeM3 != null ? `${stop.volumeM3} m³` : "—"}
                            {stop.status !== "pending" ? ` · ${stop.status}` : ""}
                          </p>
                        </div>
                        {!locked && !done ? (
                          <div className="field-dispatch-stop-actions">
                            {stop.lat != null && stop.lon != null ? (
                              <a
                                className="btn-ghost"
                                href={mapsNavigateUrl(stop.lat, stop.lon)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Navigate
                              </a>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={busy}
                              onClick={() => void patchStop(selected.id, stop.id, "done")}
                            >
                              Complete
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : (
          <section className="field-panel">
            <header className="field-panel-head">
              <h3>Proof of delivery</h3>
              <p className="muted">Photo POD per stop</p>
            </header>
            <ul className="field-dispatch-stops">
              {selected.stops.map((stop, i) => (
                <li key={stop.id} className="field-dispatch-stop">
                  <div>
                    <strong>
                      #{i + 1} {stop.name}
                    </strong>
                    <div className="dispatch-proof-thumbs">
                      {(photosByStop[stop.id] || []).map((p) => (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                          <img src={p.url} alt={p.caption || "POD"} />
                        </a>
                      ))}
                    </div>
                  </div>
                  {!locked ? (
                    <label className="field-photo-btn">
                      Take / upload photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        hidden
                        disabled={busy}
                        onChange={(e) => void onPhoto(stop.id, e)}
                      />
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="field-jobs">
      <div className="field-jobs-toolbar">
        <div className="field-date-nav" role="group" aria-label="Plan date">
          <button type="button" className="btn-ghost" aria-label="Previous day" onClick={() => setPlanDate((d) => shiftServiceDate(d, -1))}>
            ‹
          </button>
          <strong>{formatServiceDateLabel(planDate)}</strong>
          <button type="button" className="btn-ghost" aria-label="Next day" onClick={() => setPlanDate((d) => shiftServiceDate(d, 1))}>
            ›
          </button>
          {planDate !== todayServiceDate() ? (
            <button type="button" className="btn-ghost" onClick={() => setPlanDate(todayServiceDate())}>
              Today
            </button>
          ) : null}
        </div>
        <button type="button" className="btn-ghost field-refresh-btn" disabled={loading} onClick={() => void loadJobs()}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <p className="muted" style={{ margin: "0 0 8px" }}>
        {openJobs.length} open · {closedJobs.length} recent closed
      </p>

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
                      {dispatchVehicleLabel(job)} · {job.stops.length} stops · {job.utilizationPct ?? 0}%
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
