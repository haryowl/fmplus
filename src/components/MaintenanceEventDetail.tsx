import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  emptyLine,
  eventVehicleLabel,
  fetchMaintFieldUsers,
  fetchServiceEvent,
  fetchServicePoints,
  LINE_KIND_LABELS,
  patchServiceEvent,
  SERVICE_STATUS_LABELS,
  uploadMaintPhoto,
  type FieldUserOption,
  type LineKind,
  type ServiceEvent,
  type ServiceEventStatus,
  type ServiceLine,
  type ServicePoint,
} from "../lib/maintenance";
import { formatKm } from "../lib/format";
import { fullHref, tripsHref } from "../lib/routing";
import { tenantHeaders } from "../lib/tenant";

type Props = {
  eventId: string;
  onClose: () => void;
  onSaved: (event: ServiceEvent) => void;
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

function vehicleSearch(userId: number): string {
  const params = new URLSearchParams(window.location.search);
  params.set("userId", String(userId));
  params.delete("userIds");
  params.delete("eventId");
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function MaintenanceEventDetail({ eventId, onClose, onSaved }: Props) {
  const [event, setEvent] = useState<ServiceEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  const [lines, setLines] = useState<ServiceLine[]>([emptyLine()]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      fetchServiceEvent(eventId, ac.signal),
      fetchMaintFieldUsers().catch(() => [] as FieldUserOption[]),
    ])
      .then(([ev, users]) => {
        setEvent(ev);
        setFieldUsers(users.filter((u) => u.enabled));
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
    setLines(ev.lines?.length ? ev.lines.map((l) => ({ ...l })) : [emptyLine()]);
  }

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
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        notes: notes.trim(),
        startedAt: fromLocalInput(startedAt),
        endedAt: fromLocalInput(endedAt),
        odometerKm: odometerKm.trim() === "" ? null : Number(odometerKm),
        servicePointName: servicePointName.trim() || null,
        servicePointLat: servicePointLat.trim() === "" ? null : Number(servicePointLat),
        servicePointLon: servicePointLon.trim() === "" ? null : Number(servicePointLon),
        assignedFieldUserId: assignedFieldUserId || null,
        upsertServicePoint: Boolean(servicePointName.trim()),
        lines: lines
          .filter((l) => l.description.trim() || l.unitPrice != null || l.unitCost != null)
          .map((l, i) => ({
            kind: l.kind,
            description: l.description,
            qty: Number(l.qty) || 1,
            unitPrice: l.unitPrice,
            unitCost: l.unitCost,
            vendor: l.vendor,
            sortOrder: i,
          })),
        ...extra,
      };
      if (servicePointId) body.servicePointId = servicePointId;
      const updated = await patchServiceEvent(event.id, body);
      setEvent(updated);
      applyForm(updated);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: ServiceEventStatus) {
    await save({ status });
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !event) return;
    setBusy(true);
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
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
        <button type="button" className="btn-ghost" onClick={onClose}>
          Back to board
        </button>
      </section>
    );
  }

  const search = event.armadaUserId ? vehicleSearch(event.armadaUserId) : "";

  return (
    <section className="maintenance-detail">
      <div className="maintenance-detail-head">
        <button type="button" className="btn-ghost" onClick={onClose}>
          ← Board
        </button>
        <span className={`maint-badge maint-status-${event.status}`}>
          {SERVICE_STATUS_LABELS[event.status]}
        </span>
        <span className="muted">{eventVehicleLabel(event)}</span>
        {event.armadaUserId ? (
          <span className="maintenance-detail-links">
            <a className="btn-ghost" href={tripsHref(search)}>
              Trips
            </a>
            <a className="btn-ghost" href={fullHref(search)}>
              Full
            </a>
          </span>
        ) : null}
      </div>

      {error && <div className="banner error">{error}</div>}

      <form
        className="maintenance-detail-form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="span-2">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </label>
        <label className="span-2">
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <label>
          Started
          <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </label>
        <label>
          Ended
          <input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
        </label>
        <label>
          Odometer (km)
          <input
            inputMode="decimal"
            value={odometerKm}
            onChange={(e) => setOdometerKm(e.target.value)}
            placeholder={event.odometerKm != null ? formatKm(event.odometerKm) : ""}
          />
        </label>
        <label>
          Assign field user
          <select value={assignedFieldUserId} onChange={(e) => setAssignedFieldUserId(e.target.value)}>
            <option value="">Unassigned (all operators see it)</option>
            {fieldUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.username} ({u.role})
              </option>
            ))}
          </select>
        </label>

        <fieldset className="span-2 maintenance-point">
          <legend>Service point</legend>
          <label>
            Name
            <input
              value={servicePointName}
              onChange={(e) => void searchPoints(e.target.value)}
              placeholder="Workshop / dealer / yard"
              list="maint-point-hints"
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
                  <button type="button" className="btn-ghost" onClick={() => pickPoint(p)}>
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
              <input value={servicePointLat} onChange={(e) => setServicePointLat(e.target.value)} />
            </label>
            <label>
              Lon
              <input value={servicePointLon} onChange={(e) => setServicePointLon(e.target.value)} />
            </label>
            <button type="button" className="btn-ghost" onClick={useVehiclePin} disabled={event.lat == null}>
              Use vehicle pin
            </button>
          </div>
        </fieldset>

        <fieldset className="span-2 maintenance-lines">
          <legend>Line items</legend>
          {lines.map((line, idx) => (
            <div key={idx} className="maintenance-line-row">
              <select
                value={line.kind}
                onChange={(e) => updateLine(idx, { kind: e.target.value as LineKind })}
                aria-label="Kind"
              >
                {(Object.keys(LINE_KIND_LABELS) as LineKind[]).map((k) => (
                  <option key={k} value={k}>
                    {LINE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <input
                placeholder="Description"
                value={line.description}
                onChange={(e) => updateLine(idx, { description: e.target.value })}
              />
              <input
                type="number"
                step="any"
                min={0}
                placeholder="Qty"
                value={line.qty}
                onChange={(e) => updateLine(idx, { qty: Number(e.target.value) || 0 })}
              />
              <input
                type="number"
                step="any"
                placeholder="Unit price"
                value={line.unitPrice ?? ""}
                onChange={(e) =>
                  updateLine(idx, {
                    unitPrice: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <input
                type="number"
                step="any"
                placeholder="Unit cost"
                value={line.unitCost ?? ""}
                onChange={(e) =>
                  updateLine(idx, {
                    unitCost: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <input
                placeholder="Vendor"
                value={line.vendor}
                onChange={(e) => updateLine(idx, { vendor: e.target.value })}
              />
              <button type="button" className="btn-ghost" onClick={() => removeLine(idx)}>
                ×
              </button>
            </div>
          ))}
          <div className="maintenance-lines-footer">
            <button type="button" className="btn-ghost" onClick={() => setLines((p) => [...p, emptyLine()])}>
              Add line
            </button>
            <span className="muted">
              Price Σ {priceTotal.toFixed(2)} · Cost Σ {costTotal.toFixed(2)}
            </span>
          </div>
        </fieldset>

        <div className="span-2 maintenance-detail-actions">
          <button type="submit" className="btn" disabled={busy}>
            Save
          </button>
          {event.status === "due" && (
            <button type="button" className="btn" disabled={busy} onClick={() => void setStatus("in_progress")}>
              Start
            </button>
          )}
          {(event.status === "due" || event.status === "in_progress") && (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => void setStatus("done")}>
                Done
              </button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void setStatus("skipped")}>
                Skip
              </button>
            </>
          )}
          {(event.status === "done" || event.status === "skipped") && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void setStatus("due")}>
              Reopen
            </button>
          )}
        </div>
      </form>

      <div className="maintenance-photos">
        <div className="maintenance-photos-head">
          <h3>Proof of maintenance</h3>
          <label className="btn-ghost maint-photo-upload">
            Add photo
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto(e)} />
          </label>
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
