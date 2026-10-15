import { useEffect, useState, type FormEvent } from "react";
import { CsvImportPanel } from "./CsvImportPanel";
import {
  dispatchCustomerCsvFromItems,
  dispatchCustomerCsvTemplate,
  downloadCsv,
  parseCsv,
} from "../lib/csvImport";
import { useDeskSession } from "../lib/deskSession";
import {
  createDispatchCustomer,
  deleteDispatchCustomer,
  fetchDispatchCustomers,
  importDispatchCustomers,
  patchDispatchCustomer,
  type DispatchCustomer,
} from "../lib/dispatch";

type Props = {
  onClose?: () => void;
  onUse?: (customer: DispatchCustomer) => void;
};

export function DispatchCustomersPanel({ onClose, onUse }: Props) {
  const asPage = !onClose;
  const { user, privileges } = useDeskSession();
  const canEdit = privileges.editDispatchCustomers === true;
  const canDelete = privileges.deleteDispatchCustomers === true;
  const [items, setItems] = useState<DispatchCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [zone, setZone] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");

  async function reload(signal?: AbortSignal) {
    setItems(await fetchDispatchCustomers(signal));
  }

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError("");
    void reload(ac.signal)
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, []);

  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const latN = Number(lat);
    const lonN = Number(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) {
      setError("Latitude and longitude are required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await createDispatchCustomer({
        name: name.trim(),
        lat: latN,
        lon: lonN,
        zone: zone.trim(),
        address: address.trim(),
        phone: phone.trim(),
        contactName: contact.trim(),
        notes: notes.trim(),
      });
      setName("");
      setLat("");
      setLon("");
      setZone("");
      setAddress("");
      setPhone("");
      setContact("");
      setNotes("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(item: DispatchCustomer, patch: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await patchDispatchCustomer(item.id, patch);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: DispatchCustomer) {
    if (!window.confirm(`Remove “${item.name}” from the customer list?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteDispatchCustomer(item.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const q = filter.trim().toLowerCase();
  const shown = items.filter((it) => {
    if (!q) return true;
    return [it.name, it.zone, it.address, it.phone, it.contactName].join(" ").toLowerCase().includes(q);
  });

  return (
    <section
      className={`dispatch-goods-catalog${onClose ? " is-dialog" : ""}${asPage ? " is-master-desk" : ""}`}
    >
      {!asPage ? (
        <div className="dispatch-goods-catalog-head">
          <div>
            <p className="dispatch-eyebrow">Orders</p>
            <h2>Customers</h2>
            <p className="dispatch-search-hint">
              Name and coordinates are required. Picking a customer copies them onto a new order.
            </p>
          </div>
          {onClose ? (
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="dispatch-window-warn" role="alert">
          {error}
        </p>
      ) : null}

      {!canEdit ? (
        <p className="desk-master-hint">
          {user
            ? "View only — your Field user is not allowed to edit Customers."
            : "View only — sign in with a Field user that has Customers edit rights to add or change locations."}
        </p>
      ) : null}
      {canEdit ? (
      <div className="master-card">
        <p className="master-card-kicker">Add customer — compact</p>
        <form className="master-add-form is-customers" onSubmit={(e) => void addItem(e)}>
          <label className="master-field is-wide">
            <span>Customer name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>Latitude</span>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="-6.2"
              inputMode="decimal"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>Longitude</span>
            <input
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="106.8"
              inputMode="decimal"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>Zone</span>
            <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Zone" disabled={busy} />
          </label>
          <label className="master-field is-wide">
            <span>Address</span>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street / landmark"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" disabled={busy} />
          </label>
          <label className="master-field">
            <span>Contact</span>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Contact"
              disabled={busy}
            />
          </label>
          <label className="master-field is-wide">
            <span>Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" disabled={busy} />
          </label>
          <div className="master-add-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              + Add customer
            </button>
          </div>
        </form>
      </div>
      ) : null}

      <div className="master-toolbar">
        <input
          type="search"
          className="master-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter customer or zone…"
          autoComplete="off"
          aria-label="Filter customers"
        />
        <div className="master-toolbar-actions">
          {canEdit ? (
          <CsvImportPanel
            title="Import"
            disabled={busy || loading}
            templateFilename="dispatch-customers-template.csv"
            hint="Required: name, lat, lon. Optional: zone, address, phone, contact_name, notes, window_start, window_end, proof_required, enabled. Matching name updates the customer. Max 500 rows."
            onDownloadTemplate={() =>
              downloadCsv("dispatch-customers-template.csv", dispatchCustomerCsvTemplate())
            }
            parseFile={(text) => {
              const { headers, rows } = parseCsv(text);
              const missing = ["name", "lat", "lon"].filter((h) => !headers.includes(h));
              if (missing.length) return { rows: [], error: `Missing columns: ${missing.join(", ")}` };
              if (!rows.length) return { rows: [], error: "No data rows found" };
              if (rows.length > 500) return { rows: [], error: "Maximum 500 rows per import" };
              return { rows };
            }}
            onImport={async (rows) => {
              setBusy(true);
              setError("");
              try {
                const out = await importDispatchCustomers({ rows });
                await reload();
                return out;
              } catch (err) {
                const msg = err instanceof Error ? err.message : "Import failed";
                setError(msg);
                throw err;
              } finally {
                setBusy(false);
              }
            }}
          />
          ) : null}
          {items.length ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => downloadCsv("dispatch-customers.csv", dispatchCustomerCsvFromItems(items))}
            >
              Export
            </button>
          ) : null}
          <span className="master-count">
            {shown.length} location{shown.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {loading ? <p className="dispatch-search-hint">Loading customers…</p> : null}
      {!loading && shown.length === 0 ? (
        <p className="dispatch-search-hint">No customers yet. Add a name and coordinates, or import a CSV.</p>
      ) : null}

      {shown.length ? (
        <div className="master-table-wrap">
          <div className="master-table-head is-customers" role="row">
            <span>Customer</span>
            <span>Lat</span>
            <span>Lon</span>
            <span>Zone</span>
            <span>Phone</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          <ul className="master-table-list">
            {shown.map((item) => (
              <li key={item.id} className={`master-table-row is-customers${!item.enabled ? " is-disabled" : ""}`}>
                <div className="master-cell-primary">
                  <input
                    className="master-inline-name"
                    defaultValue={item.name}
                    disabled={busy || !canEdit}
                    readOnly={!canEdit}
                    aria-label="Customer name"
                    onBlur={(e) => {
                      if (!canEdit) return;
                      const next = e.target.value.trim();
                      if (next && next !== item.name) void save(item, { name: next });
                    }}
                  />
                  <p className="master-cell-meta">
                    {[item.address, item.contactName ? `Contact ${item.contactName}` : "", item.notes]
                      .filter(Boolean)
                      .join(" · ") || "No address or notes"}
                  </p>
                </div>
                <input
                  className="master-inline-input"
                  defaultValue={String(item.lat)}
                  disabled={busy || !canEdit}
                  readOnly={!canEdit}
                  inputMode="decimal"
                  aria-label="Latitude"
                  onBlur={(e) => {
                    if (!canEdit) return;
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next !== item.lat) void save(item, { lat: next });
                  }}
                />
                <input
                  className="master-inline-input"
                  defaultValue={String(item.lon)}
                  disabled={busy || !canEdit}
                  readOnly={!canEdit}
                  inputMode="decimal"
                  aria-label="Longitude"
                  onBlur={(e) => {
                    if (!canEdit) return;
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next !== item.lon) void save(item, { lon: next });
                  }}
                />
                <input
                  className="master-pill-input"
                  defaultValue={item.zone}
                  placeholder="Zone"
                  disabled={busy || !canEdit}
                  readOnly={!canEdit}
                  aria-label="Zone"
                  onBlur={(e) => {
                    if (!canEdit) return;
                    if (e.target.value.trim() !== item.zone) void save(item, { zone: e.target.value.trim() });
                  }}
                />
                <input
                  className="master-inline-input"
                  defaultValue={item.phone}
                  placeholder="—"
                  disabled={busy || !canEdit}
                  readOnly={!canEdit}
                  aria-label="Phone"
                  onBlur={(e) => {
                    if (!canEdit) return;
                    if (e.target.value.trim() !== item.phone) void save(item, { phone: e.target.value.trim() });
                  }}
                />
                <label className={`master-switch${item.enabled ? " is-on" : ""}`} title={item.enabled ? "On" : "Off"}>
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    disabled={busy || !canEdit}
                    onChange={(e) => {
                      if (!canEdit) return;
                      void save(item, { enabled: e.target.checked });
                    }}
                  />
                  <span aria-hidden />
                </label>
                <div className="master-row-actions">
                  {onUse ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy || !item.enabled}
                      onClick={() => onUse(item)}
                    >
                      Use
                    </button>
                  ) : null}
                  {canDelete ? (
                  <button
                    type="button"
                    className="master-icon-btn"
                    disabled={busy}
                    aria-label={`Remove ${item.name}`}
                    onClick={() => void removeItem(item)}
                  >
                    ⌫
                  </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
