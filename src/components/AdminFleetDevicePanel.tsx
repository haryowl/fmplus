import { useEffect, useMemo, useState, type FormEvent } from "react";

export type FleetDeviceRow = {
  id: string;
  imei: string;
  uniqueId?: string;
  protocol: string;
  label: string;
  description?: string;
  plate?: string;
  vin?: string;
  make?: string;
  model?: string;
  modelYear?: number | null;
  vehicleType?: string;
  color?: string;
  cameraChannels?: number;
  tags?: string[];
  customAttrs?: Record<string, unknown>;
  armadaUserId: number | null;
  enabled: boolean;
  profileId?: string | null;
  lastSeenAt?: string | null;
  lastFix?: {
    lat: number;
    lon: number;
    recordedAt: string | null;
    speed: number | null;
  } | null;
};

export type DeviceFieldDef = {
  id: string;
  label: string;
  valueType: string;
  unit?: string;
  description?: string;
  selectOptions?: string[];
  sortOrder?: number;
  enabled?: boolean;
};

type ProfileOpt = { id: string; name: string; protocol: string };

type Props = {
  devices: FleetDeviceRow[];
  profiles: ProfileOpt[];
  fieldDefs: DeviceFieldDef[];
  onlineImeis: Set<string>;
  protocolOptions: Array<{ value: string; label: string }>;
  busy: boolean;
  onRefresh: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
  onUpdate: (deviceId: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (deviceId: string, imei: string) => Promise<void>;
  onCreateField: (body: Record<string, unknown>) => Promise<void>;
  onDeleteField: (fieldId: string) => Promise<void>;
};

const VEHICLE_TYPES = ["", "truck", "van", "car", "bus", "motorcycle", "trailer", "other"];

function displayName(d: FleetDeviceRow): string {
  return (d.label || d.plate || d.imei || "Device").trim();
}

function ageLabel(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h`;
  return `${Math.round(ms / 86400_000)}d`;
}

export function AdminFleetDevicePanel({
  devices,
  profiles,
  fieldDefs,
  onlineImeis,
  protocolOptions,
  busy,
  onRefresh,
  onCreate,
  onUpdate,
  onDelete,
  onCreateField,
  onDeleteField,
}: Props) {
  const [query, setQuery] = useState("");
  const [protocolFilter, setProtocolFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [fieldId, setFieldId] = useState("");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldType, setFieldType] = useState("text");

  const selected = devices.find((d) => d.id === selectedId) || null;

  useEffect(() => {
    if (!selected) {
      if (!creating) setDraft({});
      return;
    }
    setCreating(false);
    setDraft({
      label: selected.label || "",
      description: selected.description || "",
      plate: selected.plate || "",
      vin: selected.vin || "",
      make: selected.make || "",
      model: selected.model || "",
      modelYear: selected.modelYear ?? "",
      vehicleType: selected.vehicleType || "",
      color: selected.color || "",
      cameraChannels: selected.cameraChannels ?? 0,
      tags: (selected.tags || []).join(", "),
      protocol: selected.protocol,
      profileId: selected.profileId || "",
      armadaUserId: selected.armadaUserId ?? "",
      enabled: selected.enabled !== false,
      uniqueId: selected.uniqueId || "",
      customAttrs: { ...(selected.customAttrs || {}) },
    });
  }, [selectedId, selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (protocolFilter && d.protocol !== protocolFilter) return false;
      if (!q) return true;
      const hay = [d.label, d.plate, d.imei, d.make, d.model, d.vehicleType, ...(d.tags || [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [devices, query, protocolFilter]);

  function startCreate() {
    setSelectedId(null);
    setCreating(true);
    setDraft({
      imei: "",
      label: "",
      description: "",
      plate: "",
      protocol: protocolOptions[0]?.value || "teltonika",
      profileId: "",
      enabled: true,
      cameraChannels: 0,
      tags: "",
      customAttrs: {},
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const customAttrs =
      draft.customAttrs && typeof draft.customAttrs === "object"
        ? (draft.customAttrs as Record<string, unknown>)
        : {};
    const body: Record<string, unknown> = {
      label: draft.label,
      description: draft.description,
      plate: draft.plate,
      vin: draft.vin,
      make: draft.make,
      model: draft.model,
      modelYear: draft.modelYear === "" || draft.modelYear == null ? null : Number(draft.modelYear),
      vehicleType: draft.vehicleType,
      color: draft.color,
      cameraChannels: Number(draft.cameraChannels) || 0,
      tags: String(draft.tags || ""),
      protocol: draft.protocol,
      profileId: draft.profileId || null,
      armadaUserId: draft.armadaUserId === "" || draft.armadaUserId == null ? null : Number(draft.armadaUserId),
      enabled: draft.enabled !== false,
      uniqueId: draft.uniqueId,
      customAttrs,
    };
    if (creating) {
      body.imei = draft.imei;
      await onCreate(body);
      setCreating(false);
      return;
    }
    if (!selectedId) return;
    await onUpdate(selectedId, body);
  }

  const enabledFields = fieldDefs.filter((f) => f.enabled !== false);

  return (
    <div className="fleet-dev">
      <header className="fleet-dev-head">
        <div>
          <h3>Fleet devices</h3>
          <p className="muted">Name, plate, type, remap profile, and custom fleet fields</p>
        </div>
        <div className="admin-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={startCreate}>
            + Add device
          </button>
        </div>
      </header>

      <div className="fleet-dev-layout">
        <aside className="fleet-dev-list-pane">
          <div className="fleet-dev-filters">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, plate, IMEI…"
              aria-label="Search devices"
            />
            <select
              value={protocolFilter}
              onChange={(e) => setProtocolFilter(e.target.value)}
              aria-label="Protocol filter"
            >
              <option value="">All protocols</option>
              {protocolOptions.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <ul className="fleet-dev-list">
            {filtered.map((d) => {
              const online = onlineImeis.has(d.imei);
              const active = d.id === selectedId && !creating;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`fleet-dev-card${active ? " is-active" : ""}${d.enabled === false ? " is-off" : ""}`}
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(d.id);
                    }}
                  >
                    <span className="fleet-dev-card-top">
                      <strong>{displayName(d)}</strong>
                      <span className={`fleet-dev-dot${online ? " is-on" : ""}`} title={online ? "Online" : "Offline"} />
                    </span>
                    <span className="fleet-dev-card-meta muted">
                      {d.plate ? `${d.plate} · ` : ""}
                      {d.protocol}
                      {d.vehicleType ? ` · ${d.vehicleType}` : ""}
                    </span>
                    <span className="fleet-dev-card-meta muted">
                      {d.imei} · seen {ageLabel(d.lastSeenAt || d.lastFix?.recordedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 ? <li className="muted admin-empty">No devices match.</li> : null}
          </ul>
        </aside>

        <section className="fleet-dev-editor">
          {!creating && !selected ? (
            <div className="fleet-dev-empty">
              <h4>Select a device</h4>
              <p className="muted">Or add a new fleet asset to set name, plate, and mapper profile.</p>
            </div>
          ) : (
            <form className="fleet-dev-form" onSubmit={(e) => void save(e)}>
              <header className="fleet-dev-form-head">
                <div>
                  <h4>{creating ? "New device" : displayName(selected!)}</h4>
                  {!creating && selected ? (
                    <p className="muted mono">{selected.imei}</p>
                  ) : null}
                </div>
                {!creating && selected ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void onDelete(selected.id, selected.imei)}
                  >
                    Delete
                  </button>
                ) : null}
              </header>

              <div className="fleet-dev-form-grid">
                {creating ? (
                  <label>
                    IMEI / unique id
                    <input
                      value={String(draft.imei || "")}
                      onChange={(e) => setDraft((d) => ({ ...d, imei: e.target.value }))}
                      required
                      minLength={5}
                      autoComplete="off"
                    />
                  </label>
                ) : null}
                <label>
                  Display name
                  <input
                    value={String(draft.label || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                    placeholder="B 1234 ABC"
                  />
                </label>
                <label>
                  Plate / reg
                  <input
                    value={String(draft.plate || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, plate: e.target.value }))}
                  />
                </label>
                <label className="span-2">
                  Description
                  <textarea
                    rows={2}
                    value={String(draft.description || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="Ops notes…"
                  />
                </label>
                <label>
                  Protocol
                  <select
                    value={String(draft.protocol || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, protocol: e.target.value }))}
                  >
                    {protocolOptions.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Remap profile
                  <select
                    value={String(draft.profileId || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, profileId: e.target.value }))}
                  >
                    <option value="">Default for protocol</option>
                    {profiles
                      .filter((p) => !draft.protocol || p.protocol === draft.protocol)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Make
                  <input
                    value={String(draft.make || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, make: e.target.value }))}
                  />
                </label>
                <label>
                  Model
                  <input
                    value={String(draft.model || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                  />
                </label>
                <label>
                  Year
                  <input
                    type="number"
                    min={1980}
                    max={2100}
                    value={draft.modelYear === null || draft.modelYear === undefined ? "" : String(draft.modelYear)}
                    onChange={(e) => setDraft((d) => ({ ...d, modelYear: e.target.value }))}
                  />
                </label>
                <label>
                  Vehicle type
                  <select
                    value={String(draft.vehicleType || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, vehicleType: e.target.value }))}
                  >
                    {VEHICLE_TYPES.map((t) => (
                      <option key={t || "any"} value={t}>
                        {t || "—"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Color
                  <input
                    value={String(draft.color || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                  />
                </label>
                <label>
                  VIN
                  <input
                    value={String(draft.vin || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, vin: e.target.value }))}
                  />
                </label>
                <label>
                  Camera channels
                  <input
                    type="number"
                    min={0}
                    max={32}
                    value={Number(draft.cameraChannels) || 0}
                    onChange={(e) => setDraft((d) => ({ ...d, cameraChannels: e.target.value }))}
                  />
                </label>
                <label>
                  Armada user id
                  <input
                    type="number"
                    value={draft.armadaUserId === null || draft.armadaUserId === undefined ? "" : String(draft.armadaUserId)}
                    onChange={(e) => setDraft((d) => ({ ...d, armadaUserId: e.target.value }))}
                    placeholder="optional link"
                  />
                </label>
                <label className="span-2">
                  Tags
                  <input
                    value={String(draft.tags || "")}
                    onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                    placeholder="depot-a, refrigerated"
                  />
                </label>
                <label className="fleet-dev-check">
                  <input
                    type="checkbox"
                    checked={draft.enabled !== false}
                    onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                  />
                  Enabled
                </label>
              </div>

              {enabledFields.length ? (
                <div className="fleet-dev-custom">
                  <h5>Custom fields</h5>
                  <div className="fleet-dev-form-grid">
                    {enabledFields.map((f) => {
                      const attrs =
                        draft.customAttrs && typeof draft.customAttrs === "object"
                          ? (draft.customAttrs as Record<string, unknown>)
                          : {};
                      const val = attrs[f.id];
                      const setVal = (next: unknown) =>
                        setDraft((d) => ({
                          ...d,
                          customAttrs: { ...(d.customAttrs as object), [f.id]: next },
                        }));
                      if (f.valueType === "bool") {
                        return (
                          <label key={f.id} className="fleet-dev-check">
                            <input
                              type="checkbox"
                              checked={val === true}
                              onChange={(e) => setVal(e.target.checked)}
                            />
                            {f.label}
                          </label>
                        );
                      }
                      if (f.valueType === "select") {
                        return (
                          <label key={f.id}>
                            {f.label}
                            <select value={String(val ?? "")} onChange={(e) => setVal(e.target.value)}>
                              <option value="">—</option>
                              {(f.selectOptions || []).map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          </label>
                        );
                      }
                      return (
                        <label key={f.id}>
                          {f.label}
                          {f.unit ? ` (${f.unit})` : ""}
                          <input
                            type={f.valueType === "number" ? "number" : f.valueType === "date" ? "date" : "text"}
                            value={val == null ? "" : String(val)}
                            onChange={(e) => setVal(e.target.value)}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="admin-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {creating ? "Register" : "Save"}
                </button>
                {creating ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setCreating(false);
                      setDraft({});
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          )}

          <details className="fleet-dev-fields-fold">
            <summary>Custom field definitions ({fieldDefs.length})</summary>
            <form
              className="fleet-dev-form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void onCreateField({
                  id: fieldId,
                  label: fieldLabel || fieldId,
                  valueType: fieldType,
                }).then(() => {
                  setFieldId("");
                  setFieldLabel("");
                });
              }}
            >
              <label>
                Id
                <input
                  value={fieldId}
                  onChange={(e) => setFieldId(e.target.value)}
                  placeholder="fleet_code"
                  required
                  pattern="[a-z][a-z0-9_]{1,62}"
                />
              </label>
              <label>
                Label
                <input value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} placeholder="Fleet code" />
              </label>
              <label>
                Type
                <select value={fieldType} onChange={(e) => setFieldType(e.target.value)}>
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="bool">Boolean</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </select>
              </label>
              <div className="admin-actions">
                <button type="submit" className="btn btn-secondary" disabled={busy || !fieldId.trim()}>
                  Add field
                </button>
              </div>
            </form>
            <ul className="fleet-dev-field-list">
              {fieldDefs.map((f) => (
                <li key={f.id}>
                  <span>
                    <strong>{f.label}</strong>
                    <span className="muted"> · {f.id} · {f.valueType}</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => void onDeleteField(f.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  );
}
