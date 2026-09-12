import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { prepareImageDataUrl } from "../lib/imageUpload";
import {
  DISPATCH_STATUS_LABELS,
  dispatchVehicleLabel,
  fieldDispatchCalendar,
  fieldPatchStop,
  fieldStopPhotos,
  formatDispatchWindow,
  formatServiceDateLabel,
  mapsNavigateUrl,
  readPhonePosition,
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

type View = "calendar" | "jobs" | "orders" | "activeStop";

function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const last = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

function ymdFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function FieldDispatchPanel({ onError, onNotice }: Props) {
  const [view, setView] = useState<View>("calendar");
  const [jobs, setJobs] = useState<DispatchJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState(todayServiceDate);
  const [calYear, setCalYear] = useState(() => {
    const t = todayServiceDate();
    return Number(t.slice(0, 4));
  });
  const [calMonth, setCalMonth] = useState(() => {
    const t = todayServiceDate();
    return Number(t.slice(5, 7)) - 1;
  });
  const [markedDays, setMarkedDays] = useState<Record<string, number>>({});
  const [fieldNote, setFieldNote] = useState("");
  const [stopNote, setStopNote] = useState("");
  const [photos, setPhotos] = useState<DispatchPhoto[]>([]);
  const [gpsWarn, setGpsWarn] = useState("");
  const onErrorRef = useRef(onError);
  const onNoticeRef = useRef(onNotice);
  onErrorRef.current = onError;
  onNoticeRef.current = onNotice;

  const selected = useMemo(
    () => jobs.find((j) => j.id === selectedId) || null,
    [jobs, selectedId],
  );

  const activeStop = useMemo(
    () => selected?.stops.find((s) => s.id === activeStopId) || null,
    [selected, activeStopId],
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

  const loadCalendar = useCallback(async () => {
    const { from, to } = monthBounds(calYear, calMonth);
    try {
      const days = await fieldDispatchCalendar(from, to);
      const map: Record<string, number> = {};
      for (const d of days) map[d.date] = d.jobCount;
      setMarkedDays(map);
      onErrorRef.current("");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Could not load calendar");
      setMarkedDays({});
    }
  }, [calYear, calMonth]);

  useEffect(() => {
    if (view === "calendar") void loadCalendar();
  }, [view, loadCalendar]);

  useEffect(() => {
    if (view === "jobs" || view === "orders" || view === "activeStop") void loadJobs();
  }, [view, loadJobs]);

  useEffect(() => {
    if (!selected) {
      setFieldNote("");
      return;
    }
    setFieldNote(selected.fieldNote || "");
  }, [selected?.id, selected?.fieldNote]);

  useEffect(() => {
    if (!selected || !activeStop) {
      setStopNote("");
      setPhotos([]);
      return;
    }
    setStopNote(activeStop.notes || "");
    let cancelled = false;
    void fieldStopPhotos(selected.id, activeStop.id)
      .then((list) => {
        if (!cancelled) setPhotos(list);
      })
      .catch(() => {
        if (!cancelled) setPhotos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, activeStop?.id, activeStop?.notes]);

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

  async function openActiveStop(stop: DispatchStop) {
    if (!selected) return;
    if (stop.status === "done" || stop.status === "skipped") return;
    setBusy(true);
    setGpsWarn("");
    try {
      const phone = await readPhonePosition();
      if (!phone) setGpsWarn("Phone GPS unavailable — Armada position will still be recorded if available.");
      if (stop.status === "pending") {
        const { job } = await fieldPatchStop(selected.id, stop.id, {
          status: "arrived",
          phoneLat: phone?.lat ?? null,
          phoneLon: phone?.lon ?? null,
        });
        setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
        onNoticeRef.current("Order started");
      } else {
        onNoticeRef.current("Resumed order");
      }
      setActiveStopId(stop.id);
      setView("activeStop");
      onErrorRef.current("");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Could not start order");
    } finally {
      setBusy(false);
    }
  }

  async function finishActiveStop() {
    if (!selected || !activeStop) return;
    if (activeStop.proofRequired && photos.length === 0) {
      onErrorRef.current("Proof photo is required before finishing this order");
      return;
    }
    setBusy(true);
    setGpsWarn("");
    try {
      const phone = await readPhonePosition();
      if (!phone) setGpsWarn("Phone GPS unavailable — Armada position will still be recorded if available.");
      const { job } = await fieldPatchStop(selected.id, activeStop.id, {
        status: "done",
        notes: stopNote,
        phoneLat: phone?.lat ?? null,
        phoneLon: phone?.lon ?? null,
      });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      setActiveStopId(null);
      setView("orders");
      onErrorRef.current("");
      onNoticeRef.current("Order completed");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Finish failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveStopNote() {
    if (!selected || !activeStop) return;
    setBusy(true);
    try {
      const { job } = await fieldPatchStop(selected.id, activeStop.id, { notes: stopNote });
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
      onNoticeRef.current("Note saved");
      onErrorRef.current("");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Save note failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected || !activeStop) return;
    setBusy(true);
    try {
      const dataUrl = await prepareImageDataUrl(file);
      const photo = await uploadDispatchStopPhoto(selected.id, activeStop.id, dataUrl);
      setPhotos((prev) => [photo, ...prev]);
      onNoticeRef.current("POD photo saved");
      onErrorRef.current("");
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function openDay(ymd: string) {
    setPlanDate(ymd);
    setSelectedId(null);
    setActiveStopId(null);
    setView("jobs");
    onNoticeRef.current("");
    onErrorRef.current("");
  }

  const calCells = useMemo(() => {
    const firstDow = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: ({ day: number; ymd: string } | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, ymd: ymdFromParts(calYear, calMonth, d) });
    }
    return cells;
  }, [calYear, calMonth]);

  const monthLabel = useMemo(
    () =>
      new Date(calYear, calMonth, 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [calYear, calMonth],
  );

  const today = todayServiceDate();

  if (view === "calendar") {
    return (
      <div className="field-jobs">
        <div className="field-jobs-toolbar">
          <div className="field-date-nav" role="group" aria-label="Calendar month">
            <button
              type="button"
              className="btn-ghost"
              aria-label="Previous month"
              onClick={() => {
                if (calMonth === 0) {
                  setCalMonth(11);
                  setCalYear((y) => y - 1);
                } else setCalMonth((m) => m - 1);
              }}
            >
              ‹
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              className="btn-ghost"
              aria-label="Next month"
              onClick={() => {
                if (calMonth === 11) {
                  setCalMonth(0);
                  setCalYear((y) => y + 1);
                } else setCalMonth((m) => m + 1);
              }}
            >
              ›
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                const t = todayServiceDate();
                setCalYear(Number(t.slice(0, 4)));
                setCalMonth(Number(t.slice(5, 7)) - 1);
                void loadCalendar();
              }}
            >
              Today
            </button>
          </div>
          <button type="button" className="btn-ghost field-refresh-btn" onClick={() => void loadCalendar()}>
            Refresh
          </button>
        </div>
        <p className="muted" style={{ margin: "0 0 8px" }}>
          Days with assigned jobs are marked. Tap a marked day to open jobs.
        </p>
        <div className="field-dispatch-cal" role="grid" aria-label="Dispatch calendar">
          <div className="field-dispatch-cal-dow" role="row">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <span key={d} role="columnheader">
                {d}
              </span>
            ))}
          </div>
          <div className="field-dispatch-cal-grid">
            {calCells.map((cell, i) => {
              if (!cell) return <span key={`e-${i}`} className="field-dispatch-cal-empty" />;
              const count = markedDays[cell.ymd] || 0;
              const isToday = cell.ymd === today;
              return (
                <button
                  key={cell.ymd}
                  type="button"
                  className={`field-dispatch-cal-day${count ? " has-jobs" : ""}${isToday ? " is-today" : ""}`}
                  disabled={!count}
                  onClick={() => openDay(cell.ymd)}
                >
                  <span className="field-dispatch-cal-num">{cell.day}</span>
                  {count ? <span className="field-dispatch-cal-dot" aria-label={`${count} jobs`} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (view === "activeStop" && selected && activeStop) {
    const locked = selected.status === "done" || selected.status === "cancelled";
    return (
      <div className="field-job-detail">
        <button
          type="button"
          className="btn-ghost field-back"
          disabled={busy}
          onClick={() => {
            setActiveStopId(null);
            setView("orders");
            setGpsWarn("");
            onNoticeRef.current("");
            onErrorRef.current("");
          }}
        >
          Cancel
        </button>

        <section className="field-panel field-job-hero">
          <div className="field-job-hero-top">
            <span className="field-pill">IN PROGRESS</span>
          </div>
          <h2>{activeStop.name}</h2>
          {activeStop.address ? <p className="muted">{activeStop.address}</p> : null}
          {formatDispatchWindow(activeStop) ? (
            <p className="muted">⏱ {formatDispatchWindow(activeStop)}</p>
          ) : null}
          {activeStop.proofRequired ? <p className="muted">Proof photo required</p> : null}
          {gpsWarn ? <p className="muted">{gpsWarn}</p> : null}
        </section>

        <section className="field-panel">
          <header className="field-panel-head">
            <h3>Note</h3>
          </header>
          <label className="field-label">
            Delivery note
            <textarea
              value={stopNote}
              onChange={(e) => setStopNote(e.target.value)}
              rows={3}
              disabled={locked || busy}
              readOnly={locked}
            />
          </label>
          {!locked ? (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void saveStopNote()}>
              Save note
            </button>
          ) : null}
        </section>

        <section className="field-panel">
          <header className="field-panel-head">
            <h3>Proof / take photo</h3>
            <p className="muted">{activeStop.proofRequired ? "Required before FINISH" : "Optional"}</p>
          </header>
          <div className="dispatch-proof-thumbs">
            {photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt={p.caption || "POD"} />
              </a>
            ))}
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
                onChange={(e) => void onPhoto(e)}
              />
            </label>
          ) : null}
        </section>

        <div className="field-action-row">
          <button type="button" className="btn btn-primary" disabled={busy || locked} onClick={() => void finishActiveStop()}>
            FINISH
          </button>
        </div>
      </div>
    );
  }

  if (view === "orders" && selected) {
    const locked = selected.status === "done" || selected.status === "cancelled";
    return (
      <div className="field-job-detail">
        <button
          type="button"
          className="btn-ghost field-back"
          onClick={() => {
            setSelectedId(null);
            setView("jobs");
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
            {stopsLeft} order{stopsLeft === 1 ? "" : "s"} left · {dispatchVehicleLabel(selected)}
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

        {!locked ? (
          <section className="field-panel">
            <header className="field-panel-head">
              <h3>Job</h3>
            </header>
            <div className="field-action-row">
              {selected.status === "assigned" ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void patchJob(selected.id, { status: "en_route" }).then(
                      (j) => j && onNoticeRef.current("En route"),
                    )
                  }
                >
                  Start route
                </button>
              ) : null}
              {selected.status !== "assigned" ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || stopsLeft > 0}
                  onClick={() =>
                    void patchJob(selected.id, { status: "done", fieldNote }).then((j) => {
                      if (!j) return;
                      onNoticeRef.current("Job completed");
                      setSelectedId(null);
                      setView("jobs");
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
                disabled={busy}
              />
            </label>
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
              Save job note
            </button>
          </section>
        ) : null}

        <section className="field-panel">
          <header className="field-panel-head">
            <h3>Orders · {selected.stops.length}</h3>
          </header>
          {selected.stops.length === 0 ? (
            <p className="muted">No orders on this job.</p>
          ) : (
            <ul className="field-dispatch-stops">
              {selected.stops.map((stop, i) => {
                const done = stop.status === "done" || stop.status === "skipped";
                return (
                  <li key={stop.id} className="field-dispatch-stop">
                    <div>
                      <div className="field-dispatch-stop-top">
                        <span className="field-dispatch-stop-num">#{i + 1}</span>
                        <strong>{stop.name}</strong>
                        {stop.proofRequired ? <span className="field-pill">POD</span> : null}
                      </div>
                      {formatDispatchWindow(stop) ? (
                        <p className="muted">⏱ {formatDispatchWindow(stop)}</p>
                      ) : null}
                      {stop.address ? <p className="muted">{stop.address}</p> : null}
                      <p className="muted">
                        {stop.zone ? `${stop.zone} · ` : ""}
                        {stop.volumeM3 != null ? `${stop.volumeM3} m³` : "—"}
                      </p>
                    </div>
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
                      {done ? (
                        <span className="field-pill field-pill-done">COMPLETED</span>
                      ) : !locked ? (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy}
                          onClick={() => void openActiveStop(stop)}
                        >
                          START
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="field-jobs">
      <div className="field-jobs-toolbar">
        <button
          type="button"
          className="btn-ghost field-back"
          onClick={() => {
            setView("calendar");
            setSelectedId(null);
            onNoticeRef.current("");
            onErrorRef.current("");
          }}
        >
          ← Calendar
        </button>
        <div className="field-date-nav" role="group" aria-label="Plan date">
          <button type="button" className="btn-ghost" aria-label="Previous day" onClick={() => setPlanDate((d) => shiftServiceDate(d, -1))}>
            ‹
          </button>
          <strong>{formatServiceDateLabel(planDate)}</strong>
          <button type="button" className="btn-ghost" aria-label="Next day" onClick={() => setPlanDate((d) => shiftServiceDate(d, 1))}>
            ›
          </button>
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
          <p className="muted">No jobs assigned to you on this date.</p>
        </div>
      ) : null}

      {openJobs.length > 0 ? (
        <section className="field-jobs-section">
          <h2 className="field-jobs-section-title">Open</h2>
          <ul className="field-job-list">
            {openJobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  className="field-job-row"
                  onClick={() => {
                    setSelectedId(job.id);
                    setView("orders");
                  }}
                >
                  <span className={`field-row-rail dispatch-status-${job.status}`} aria-hidden />
                  <span className="field-job-row-main">
                    <span className="field-job-row-top">
                      <strong>{job.title}</strong>
                      <span className="field-job-date">{DISPATCH_STATUS_LABELS[job.status]}</span>
                    </span>
                    <span className="field-job-row-meta muted">
                      {dispatchVehicleLabel(job)} · {job.stops.length} orders · {job.utilizationPct ?? 0}%
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
                <button
                  type="button"
                  className="field-job-row"
                  onClick={() => {
                    setSelectedId(job.id);
                    setView("orders");
                  }}
                >
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
