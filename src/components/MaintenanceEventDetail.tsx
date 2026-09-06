import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  emptyLine,
  eventVehicleLabel,
  fetchHoursAccrued,
  fetchKmAccrued,
  fetchMaintFieldUsers,
  fetchMaintenanceCatalog,
  fetchServiceEvent,
  fetchServicePoints,
  formatServiceDuration,
  deleteServiceEvent,
  patchServiceEvent,
  SERVICE_STATUS_LABELS,
  SCHEDULE_HEALTH_LABELS,
  uploadMaintPhoto,
  type CatalogGroup,
  type FieldUserOption,
  type ScheduleHealth,
  type ServiceEvent,
  type ServiceEventStatus,
  type ServiceLine,
  type ServicePoint,
} from "../lib/maintenance";
import { prepareImageDataUrl } from "../lib/imageUpload";
import { formatKm } from "../lib/format";
import { fullHref, tripsHref } from "../lib/routing";
import { tenantHeaders } from "../lib/tenant";
import { CatalogLineEditor } from "./CatalogLineEditor";

type Props = {
  eventId: string;
  onClose: () => void;
  onSaved: (event: ServiceEvent) => void;
  onOpenEvent?: (eventId: string) => void;
  canDelete?: boolean;
  onDeleted?: (eventId: string) => void;
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toLocalDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function fromLocalDateInput(value: string): string | null {
  if (!value.trim()) return null;
  const ms = Date.parse(`${value.trim()}T00:00:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(window.location.search);
  params.set("userId", String(userId));
  params.delete("userIds");
  params.delete("eventId");
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function MaintenanceEventDetail({
  eventId,
  onClose,
  onSaved,
  onOpenEvent,
  canDelete,
  onDeleted,
}: Props) {
  const [event, setEvent] = useState<ServiceEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldUsers, setFieldUsers] = useState<FieldUserOption[]>([]);
  const [pointHints, setPointHints] = useState<ServicePoint[]>([]);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [odometerKm, setOdometerKm] = useState("");
  const [servicePointName, setServicePointName] = useState("");
  const [servicePointLat, setServicePointLat] = useState("");
  const [servicePointLon, setServicePointLon] = useState("");
  const [servicePointId, setServicePointId] = useState<string | null>(null);
  const [assignedFieldUserId, setAssignedFieldUserId] = useState("");
  const [remindDueAt, setRemindDueAt] = useState("");
  const [remindIntervalDays, setRemindIntervalDays] = useState("");
  const [remindIntervalKm, setRemindIntervalKm] = useState("");
  const [remindBaselineOdometerKm, setRemindBaselineOdometerKm] = useState("");
  const [remindIntervalHours, setRemindIntervalHours] = useState("");
  const [remindHoursSinceAt, setRemindHoursSinceAt] = useState("");
  const [remindBeforeDays, setRemindBeforeDays] = useState("");
  const [remindBeforeKm, setRemindBeforeKm] = useState("");
  const [remindBeforeHours, setRemindBeforeHours] = useState("");
  const [hoursAccrued, setHoursAccrued] = useState<{
    hoursAccrued: number | null;
    intervalHours: number | null;
    due: boolean;
    lookbackCapped: boolean;
    reason: string | null;
  } | null>(null);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [kmAccrued, setKmAccrued] = useState<{
    kmAccrued: number | null;
    intervalKm: number | null;
    baselineKm: number | null;
    currentOdoKm: number | null;
    nextDueOdoKm: number | null;
    due: boolean;
    reason: string | null;
  } | null>(null);
  const [kmLoading, setKmLoading] = useState(false);
  const [lines, setLines] = useState<ServiceLine[]>([emptyLine()]);
  const [catalog, setCatalog] = useState<CatalogGroup[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      fetchServiceEvent(eventId, ac.signal),
      fetchMaintFieldUsers().catch(() => [] as FieldUserOption[]),
      fetchMaintenanceCatalog(ac.signal).catch(() => [] as CatalogGroup[]),
    ])
      .then(([ev, users, groups]) => {
        setEvent(ev);
        setFieldUsers(users.filter((u) => u.enabled));
        setCatalog(groups);
        applyForm(ev);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [eventId]);

  function applyForm(ev: ServiceEvent) {
    setTitle(ev.title);
    setNotes(ev.notes || "");
    setStartedAt(toLocalInput(ev.startedAt));
    setEndedAt(toLocalInput(ev.endedAt));
    setOdometerKm(ev.odometerKm != null ? String(ev.odometerKm) : "");
    setServicePointName(ev.servicePointName || "");
    setServicePointLat(ev.servicePointLat != null ? String(ev.servicePointLat) : "");
    setServicePointLon(ev.servicePointLon != null ? String(ev.servicePointLon) : "");
    setServicePointId(ev.servicePointId || null);
    setAssignedFieldUserId(ev.assignedFieldUserId || "");
    setRemindDueAt(toLocalDateInput(ev.remindDueAt));
    setRemindIntervalDays(ev.remindIntervalDays != null ? String(ev.remindIntervalDays) : "");
    setRemindIntervalKm(ev.remindIntervalKm != null ? String(ev.remindIntervalKm) : "");
    setRemindBaselineOdometerKm(
      ev.remindBaselineOdometerKm != null ? String(ev.remindBaselineOdometerKm) : "",
    );
    setRemindIntervalHours(ev.remindIntervalHours != null ? String(ev.remindIntervalHours) : "");
    setRemindHoursSinceAt(toLocalInput(ev.remindHoursSinceAt));
    setRemindBeforeDays(ev.remindBeforeDays != null ? String(ev.remindBeforeDays) : "");
    setRemindBeforeKm(ev.remindBeforeKm != null ? String(ev.remindBeforeKm) : "");
    setRemindBeforeHours(ev.remindBeforeHours != null ? String(ev.remindBeforeHours) : "");
    setLines(ev.lines?.length ? ev.lines.map((l) => ({ ...l })) : [emptyLine()]);
  }

  useEffect(() => {
    if (!event?.id || !(event.remindIntervalHours != null && event.remindIntervalHours > 0)) {
      setHoursAccrued(null);
      return;
    }
    const ac = new AbortController();
    setHoursLoading(true);
    void fetchHoursAccrued(event.id, ac.signal)
      .then((r) => {
        if (!ac.signal.aborted) setHoursAccrued(r);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setHoursAccrued({
            hoursAccrued: null,
            intervalHours: event.remindIntervalHours ?? null,
            due: false,
            lookbackCapped: false,
            reason: err.message,
          });
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setHoursLoading(false);
      });
    return () => ac.abort();
  }, [event?.id, event?.remindIntervalHours, event?.remindHoursSinceAt, event?.updatedAt]);

  useEffect(() => {
    if (!event?.id || !(event.remindIntervalKm != null && event.remindIntervalKm > 0)) {
      setKmAccrued(null);
      return;
    }
    const ac = new AbortController();
    setKmLoading(true);
    void fetchKmAccrued(event.id, ac.signal)
      .then((r) => {
        if (!ac.signal.aborted) setKmAccrued(r);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setKmAccrued({
            kmAccrued: null,
            intervalKm: event.remindIntervalKm ?? null,
            baselineKm: event.remindBaselineOdometerKm ?? null,
            currentOdoKm: null,
            nextDueOdoKm: null,
            due: false,
            reason: err.message,
          });
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setKmLoading(false);
      });
    return () => ac.abort();
  }, [
    event?.id,
    event?.remindIntervalKm,
    event?.remindBaselineOdometerKm,
    event?.odometerKm,
    event?.updatedAt,
  ]);

  async function searchPoints(q: string) {
    setServicePointName(q);
    setServicePointId(null);
    if (q.trim().length < 1) {
      setPointHints([]);
      return;
    }
    try {
      setPointHints(await fetchServicePoints(q.trim()));
    } catch {
      setPointHints([]);
    }
  }

  function pickPoint(p: ServicePoint) {
    setServicePointId(p.id);
    setServicePointName(p.name);
    setServicePointLat(p.lat != null ? String(p.lat) : "");
    setServicePointLon(p.lon != null ? String(p.lon) : "");
    setPointHints([]);
  }

  function useVehiclePin() {
    if (!event) return;
    if (event.lat != null) setServicePointLat(String(event.lat));
    if (event.lon != null) setServicePointLon(String(event.lon));
  }

  function updateLine(idx: number, patch: Partial<ServiceLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length <= 1 ? [emptyLine()] : prev.filter((_, i) => i !== idx)));
  }

  const priceTotal = lines.reduce((s, l) => {
    const p = l.unitPrice;
    return s + (p == null ? 0 : p * (Number(l.qty) || 0));
  }, 0);
  const costTotal = lines.reduce((s, l) => {
    const c = l.unitCost;
    return s + (c == null ? 0 : c * (Number(l.qty) || 0));
  }, 0);

  async function save(extra: Record<string, unknown> = {}) {
    if (!event) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        notes: notes.trim(),
        odometerKm: odometerKm.trim() === "" ? null : Number(odometerKm),
        servicePointName: servicePointName.trim() || null,
        servicePointLat: servicePointLat.trim() === "" ? null : Number(servicePointLat),
        servicePointLon: servicePointLon.trim() === "" ? null : Number(servicePointLon),
        assignedFieldUserId: assignedFieldUserId || null,
        remindDueAt: fromLocalDateInput(remindDueAt),
        remindIntervalDays: remindIntervalDays.trim() === "" ? null : Number(remindIntervalDays),
        remindIntervalKm: remindIntervalKm.trim() === "" ? null : Number(remindIntervalKm),
        remindBaselineOdometerKm:
          remindBaselineOdometerKm.trim() === "" ? null : Number(remindBaselineOdometerKm),
        remindIntervalHours: remindIntervalHours.trim() === "" ? null : Number(remindIntervalHours),
        remindHoursSinceAt: fromLocalInput(remindHoursSinceAt),
        remindBeforeDays: remindBeforeDays.trim() === "" ? null : Number(remindBeforeDays),
        remindBeforeKm: remindBeforeKm.trim() === "" ? null : Number(remindBeforeKm),
        remindBeforeHours: remindBeforeHours.trim() === "" ? null : Number(remindBeforeHours),
        upsertServicePoint: Boolean(servicePointName.trim()),
        lines: lines
          .filter((l) => l.description.trim() || l.unitPrice != null || l.unitCost != null)
          .map((l, i) => ({
            kind: l.kind === "labor" ? "service" : l.kind,
            catalogItemId: l.catalogItemId || null,
            description: l.description,
            qty: Number(l.qty) || 1,
            unitPrice: l.unitPrice,
            unitCost: l.unitCost,
            vendor: l.vendor,
            sortOrder: i,
          })),
        ...extra,
      };
      // Status transitions own the service clock on the server — do not send empty
      // Started/Ended fields or Start/Done will wipe started_at and block Done.
      if (!extra.status) {
        body.startedAt = fromLocalInput(startedAt);
        body.endedAt = fromLocalInput(endedAt);
      }
      if (servicePointId) body.servicePointId = servicePointId;
      const { event: updated, nextEvent } = await patchServiceEvent(event.id, body);
      setEvent(updated);
      applyForm(updated);
      onSaved(updated);
      if (extra.status === "in_progress") setNotice("Started — service clock is running.");
      else if (extra.status === "done") {
        setNotice(
          nextEvent
            ? "Done — service time recorded. Opening next due job."
            : "Done — service time recorded.",
        );
        if (nextEvent) {
          onSaved(nextEvent);
          onOpenEvent?.(nextEvent.id);
        }
      } else if (extra.status === "due" && event.status === "in_progress") setNotice("Start cancelled.");
      else if (extra.status === "skipped") setNotice("Job skipped.");
      else if (extra.status === "due") setNotice("Reopened.");
      else if (extra.status === "approved") setNotice("Approved — job is locked.");
      else if (nextEvent) {
        setNotice("Next due created — opening the new event.");
        onSaved(nextEvent);
        onOpenEvent?.(nextEvent.id);
      } else {
        setNotice("Saved.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      try {
        const refreshed = await fetchServiceEvent(event.id);
        setEvent(refreshed);
        applyForm(refreshed);
        onSaved(refreshed);
      } catch {
        /* keep form */
      }
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: ServiceEventStatus) {
    await save({ status });
  }

  async function onDelete() {
    if (!event || !canDelete) return;
    if (
      !window.confirm(
        `Delete “${event.title || "this job"}” permanently? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteServiceEvent(event.id);
      onDeleted?.(event.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !event) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await prepareImageDataUrl(file);
      await uploadMaintPhoto(event.id, dataUrl);
      const refreshed = await fetchServiceEvent(event.id);
      setEvent(refreshed);
      onSaved(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="maintenance-detail">
        <p className="muted">Loading event…</p>
      </section>
    );
  }

  if (!event) {
    return (
      <section className="maintenance-detail">
        {error && <div className="banner error">{error}</div>}
        <button type="button" className="btn-secondary" onClick={onClose}>
          Back to board
        </button>
      </section>
    );
  }

  const search = event.armadaUserId ? vehicleSearch(event.armadaUserId) : "";
  const locked = event.status === "approved";

  return (
    <section className="maintenance-detail">
      <header className="maintenance-detail-head">
        <div className="maint-detail-nav">
          <button type="button" className="btn-secondary" onClick={onClose}>
            ← Board
          </button>
          {event.armadaUserId ? (
            <span className="maintenance-detail-links">
              <a className="btn-link" href={tripsHref(search)}>
                Trips
              </a>
              <a className="btn-link" href={fullHref(search)}>
                Full
              </a>
            </span>
          ) : null}
        </div>
        <div className="maint-detail-hero">
          <div className="maint-detail-hero-text">
            <p className="maint-eyebrow">Maintenance job</p>
            <h2>{eventVehicleLabel(event)}</h2>
            <p className="maint-detail-subtitle">{event.title || "Untitled job"}</p>
          </div>
          <div className="maint-detail-hero-badges">
            <span className={`maint-badge maint-status-${event.status}`}>
              {SERVICE_STATUS_LABELS[event.status]}
            </span>
            {event.scheduleHealth &&
            event.scheduleHealth !== "none" &&
            event.scheduleHealth !== "completed" ? (
              <span className={`maint-badge maint-health-${event.scheduleHealth}`}>
                {SCHEDULE_HEALTH_LABELS[event.scheduleHealth as ScheduleHealth]}
                {event.scheduleBits?.length ? ` · ${event.scheduleBits.join("; ")}` : ""}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {event.parentEventId ? (
        <div className="banner ok">
          This is a <strong>follow-up</strong> job after a previous completion. Field Done work
          (parts, photos, service time) is on the completed parent — open it from the{" "}
          <strong>Completed</strong> filter, or{" "}
          <button type="button" className="btn-link" onClick={() => onOpenEvent?.(event.parentEventId!)}>
            open parent job
          </button>
          .
        </div>
      ) : null}
      {event.status === "done" ? (
        <div className="banner ok">
          Done — awaiting Approve
          {event.serviceDurationMinutes != null
            ? ` · service time ${formatServiceDuration(event.serviceDurationMinutes)}`
            : ""}
          . Review parts and photos, then Approve to lock for the cost dashboard.
        </div>
      ) : null}
      {event.status === "approved" ? (
        <div className="banner ok">
          Approved
          {event.approvedAt ? ` · ${String(event.approvedAt).slice(0, 10)}` : ""}
          {event.approvedBy ? ` by ${event.approvedBy}` : ""}. This job is locked.
        </div>
      ) : null}

      <form
        className="maintenance-detail-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!locked) void save();
        }}
      >
        <div className="maint-section span-2">
          <header className="maint-section-head">
            <h3>Job details</h3>
            <p>Title, notes, clock, and assignment</p>
          </header>
          <div className="maint-section-grid">
            <label className="span-2">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
                disabled={locked}
              />
            </label>
            <label className="span-2">
              Notes
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={locked} />
            </label>
            <label>
              Started
              <input
                type="datetime-local"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
                disabled={locked}
              />
            </label>
            <label>
              Ended
              <input
                type="datetime-local"
                value={endedAt}
                onChange={(e) => setEndedAt(e.target.value)}
                disabled={locked}
              />
            </label>
            <p className="span-2 muted maintenance-service-time">
              Service time (Start → Done):{" "}
              <strong>{formatServiceDuration(event.serviceDurationMinutes)}</strong>
              {event.status === "due" ? " — press Start, then Done to record wrench time." : null}
              {event.status === "in_progress" ? " — clock is running; Done closes the timer." : null}
            </p>
            <label>
              Odometer (km)
              <input
                inputMode="decimal"
                value={odometerKm}
                onChange={(e) => setOdometerKm(e.target.value)}
                placeholder={event.odometerKm != null ? formatKm(event.odometerKm) : ""}
                disabled={locked}
              />
            </label>
            <label>
              Assign field user
              <select
                value={assignedFieldUserId}
                onChange={(e) => setAssignedFieldUserId(e.target.value)}
                disabled={locked}
              >
                <option value="">Unassigned (all operators see it)</option>
                {fieldUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName || u.username} ({u.role})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="maint-section span-2">
          <header className="maint-section-head">
            <h3>Schedule / remind</h3>
            <p>Optional calendar, km, or ignition-hour intervals</p>
          </header>
          <div className="maint-section-body">
            <div className="maintenance-schedule-grid">
              <label>
                Due date
                <input
                  type="date"
                  value={remindDueAt}
                  onChange={(e) => setRemindDueAt(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Interval (days)
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="e.g. 90"
                  value={remindIntervalDays}
                  onChange={(e) => setRemindIntervalDays(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Interval (km)
                <input
                  type="number"
                  min={1}
                  step="any"
                  placeholder="e.g. 5000"
                  value={remindIntervalKm}
                  onChange={(e) => setRemindIntervalKm(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Baseline odo (km)
                <input
                  type="number"
                  step="any"
                  placeholder="Start of km interval"
                  value={remindBaselineOdometerKm}
                  onChange={(e) => setRemindBaselineOdometerKm(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Interval (hours, ign-on)
                <input
                  type="number"
                  min={1}
                  step="any"
                  placeholder="e.g. 250"
                  value={remindIntervalHours}
                  onChange={(e) => setRemindIntervalHours(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Hours since
                <input
                  type="datetime-local"
                  value={remindHoursSinceAt}
                  onChange={(e) => setRemindHoursSinceAt(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Remind before (days)
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="7"
                  value={remindBeforeDays}
                  onChange={(e) => setRemindBeforeDays(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Remind before (km)
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="500"
                  value={remindBeforeKm}
                  onChange={(e) => setRemindBeforeKm(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Remind before (hours)
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="auto"
                  value={remindBeforeHours}
                  onChange={(e) => setRemindBeforeHours(e.target.value)}
                  disabled={locked}
                />
              </label>
            </div>
            {remindIntervalKm.trim() && remindBaselineOdometerKm.trim() ? (
              <p className="muted maintenance-hint">
                Next km due around{" "}
                {(Number(remindBaselineOdometerKm) + Number(remindIntervalKm)).toLocaleString()} km
              </p>
            ) : null}
            {remindIntervalKm.trim() ? (
              <p className="muted maintenance-hint">
                {kmLoading
                  ? "Reading odometer from live status…"
                  : kmAccrued?.kmAccrued != null && kmAccrued.intervalKm != null
                    ? `Odo ${kmAccrued.currentOdoKm?.toLocaleString() ?? "—"} km · accrued ${kmAccrued.kmAccrued.toLocaleString()} / ${kmAccrued.intervalKm.toLocaleString()} km${
                        kmAccrued.due ? " — due" : ""
                      }${
                        kmAccrued.nextDueOdoKm != null
                          ? ` · next @ ${kmAccrued.nextDueOdoKm.toLocaleString()} km`
                          : ""
                      }`
                    : kmAccrued?.reason === "no_baseline"
                      ? "Set baseline odo (or create with vehicle status) to evaluate km interval."
                      : kmAccrued?.reason === "no_status_odo"
                        ? "No odometer on live status for this vehicle."
                        : kmAccrued?.reason
                          ? `Km: ${kmAccrued.reason}`
                          : "Save to evaluate km against live status odometer."}
                {kmAccrued?.currentOdoKm != null ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setRemindBaselineOdometerKm(String(kmAccrued.currentOdoKm))}
                    >
                      Use live odo as baseline
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {remindIntervalHours.trim() ? (
              <p className="muted maintenance-hint">
                {hoursLoading
                  ? "Computing ignition-on hours from tracks…"
                  : hoursAccrued?.hoursAccrued != null && hoursAccrued.intervalHours != null
                    ? `Accrued ${hoursAccrued.hoursAccrued.toFixed(1)} / ${hoursAccrued.intervalHours} h${
                        hoursAccrued.due ? " — due" : ""
                      }${hoursAccrued.lookbackCapped ? " (lookback capped at 90 days)" : ""}`
                    : hoursAccrued?.reason
                      ? `Hours: ${hoursAccrued.reason}`
                      : "Save to compute ignition-on hours from tracks."}
              </p>
            ) : null}
          </div>
        </div>

        <div className="maint-section span-2">
          <header className="maint-section-head">
            <h3>Service point</h3>
            <p>Workshop or yard where the work happens</p>
          </header>
          <div className="maint-section-body">
            <label>
              Name
              <input
                value={servicePointName}
                onChange={(e) => void searchPoints(e.target.value)}
                placeholder="Workshop / dealer / yard"
                list="maint-point-hints"
                disabled={locked}
              />
              <datalist id="maint-point-hints">
                {pointHints.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </label>
            {pointHints.length > 0 && (
              <ul className="maintenance-point-hints">
                {pointHints.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <button type="button" className="btn-link" onClick={() => pickPoint(p)}>
                      {p.name}
                      {p.lat != null && p.lon != null ? ` · ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="maintenance-point-coords">
              <label>
                Lat
                <input
                  value={servicePointLat}
                  onChange={(e) => setServicePointLat(e.target.value)}
                  disabled={locked}
                />
              </label>
              <label>
                Lon
                <input
                  value={servicePointLon}
                  onChange={(e) => setServicePointLon(e.target.value)}
                  disabled={locked}
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                onClick={useVehiclePin}
                disabled={locked || event.lat == null}
              >
                Use vehicle pin
              </button>
            </div>
          </div>
        </div>

        <div className="maint-section span-2">
          <header className="maint-section-head">
            <h3>Parts &amp; service lines</h3>
            <p>Catalog picks or free-text Others · editable price and cost</p>
          </header>
          <div className="maint-section-body">
            {lines.map((line, idx) => (
              <CatalogLineEditor
                key={idx}
                line={line}
                catalog={catalog}
                disabled={locked}
                onChange={(patch) => updateLine(idx, patch)}
                onRemove={() => removeLine(idx)}
              />
            ))}
            <div className="maintenance-lines-footer">
              <button
                type="button"
                className="btn-secondary"
                disabled={locked}
                onClick={() => setLines((p) => [...p, emptyLine()])}
              >
                Add line
              </button>
              <span className="maint-line-totals">
                <span>
                  Price <strong>{priceTotal.toFixed(2)}</strong>
                </span>
                <span>
                  Cost <strong>{costTotal.toFixed(2)}</strong>
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="span-2 maintenance-detail-actions">
          {!locked && (
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Save
            </button>
          )}
          {event.status === "due" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void setStatus("in_progress")}
            >
              Start
            </button>
          )}
          {event.status === "in_progress" && (
            <>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void setStatus("done")}>
                Done
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => void setStatus("due")}
              >
                Cancel start
              </button>
            </>
          )}
          {(event.status === "due" || event.status === "in_progress") && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void setStatus("skipped")}>
              Skip
            </button>
          )}
          {event.status === "done" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void setStatus("approved")}
            >
              Approve
            </button>
          )}
          {(event.status === "done" || event.status === "skipped") && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void setStatus("due")}>
              Reopen
            </button>
          )}
          {canDelete ? (
            <button type="button" className="maint-btn-danger" disabled={busy} onClick={() => void onDelete()}>
              Delete
            </button>
          ) : null}
        </div>
      </form>

      <div className="maint-section maintenance-photos">
        <div className="maintenance-photos-head">
          <div>
            <h3>Proof of maintenance</h3>
            <p className="muted">Photos from the field or manager</p>
          </div>
          {!locked ? (
            <label className="btn-secondary maint-photo-upload">
              Add photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e)} />
            </label>
          ) : null}
        </div>
        {(event.photos || []).length === 0 ? (
          <p className="muted">No photos yet. Field users can upload from /m.</p>
        ) : (
          <ul className="maintenance-photo-grid">
            {(event.photos || []).map((p) => (
              <li key={p.id}>
                <a href={photoUrlWithTenant(p.url)} target="_blank" rel="noreferrer">
                  <img src={photoUrlWithTenant(p.url)} alt={p.caption || "PoM"} />
                </a>
                {p.caption ? <span className="muted">{p.caption}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function photoUrlWithTenant(url: string): string {
  const k = tenantHeaders()["X-Fms-Tenant"] || currentTenantFromSearch();
  if (!k) return url;
  const u = new URL(url, window.location.origin);
  if (!u.searchParams.get("k")) u.searchParams.set("k", k);
  return `${u.pathname}${u.search}`;
}

function currentTenantFromSearch(): string {
  return new URLSearchParams(window.location.search).get("k") || "";
}
