import { useEffect, useState, type FormEvent } from "react";
import { CsvImportPanel } from "./CsvImportPanel";
import {
  dispatchCustomerCsvFromItems,
  dispatchCustomerCsvTemplate,
  downloadCsv,
  parseCsv,
} from "../lib/csvImport";
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
    <section className={`dispatch-goods-catalog${onClose ? " is-dialog" : ""}`}>
      <div className="dispatch-goods-catalog-head">
        <div>
          <p className="dispatch-eyebrow">Orders</p>
          <h2>Customers</h2>
          <p className="dispatch-search-hint">
            Name and coordinates are required. Zone, address, phone, contact, and notes are extra detail. Picking a
            customer copies them onto a new order. Editing this list later does not change orders already created.
          </p>
        </div>
        {onClose ? (
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="dispatch-window-warn" role="alert">
          {error}
        </p>
      ) : null}
      <form className="dispatch-goods-catalog-add" onSubmit={(e) => void addItem(e)}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" disabled={busy} size={1} />
        <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Lat" inputMode="decimal" disabled={busy} size={1} />
        <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Lon" inputMode="decimal" disabled={busy} size={1} />
        <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Zone" disabled={busy} size={1} />
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" disabled={busy} size={1} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" disabled={busy} size={1} />
        <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact" disabled={busy} size={1} />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" disabled={busy} size={1} />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
      <div className="dispatch-goods-catalog-tools">
        <CsvImportPanel
          title="Import customers CSV"
          disabled={busy || loading}
          templateFilename="dispatch-customers-template.csv"
          hint="Required: name, lat, lon. Optional: zone, address, phone, contact_name, notes, window_start, window_end, proof_required, enabled. Matching name updates the customer. Max 500 rows."
          onDownloadTemplate={() => downloadCsv("dispatch-customers-template.csv", dispatchCustomerCsvTemplate())}
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
        {items.length ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => downloadCsv("dispatch-customers.csv", dispatchCustomerCsvFromItems(items))}
          >
            Export customers CSV
          </button>
        ) : null}
      </div>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter customers…"
        autoComplete="off"
        size={1}
      />
      {loading ? <p className="dispatch-search-hint">Loading customers…</p> : null}
      {!loading && shown.length === 0 ? (
        <p className="dispatch-search-hint">No customers yet. Add a name and coordinates, or import a CSV.</p>
      ) : null}
      <ul className="dispatch-goods-catalog-list">
        {shown.map((item) => (
          <li key={item.id} className={!item.enabled ? "is-disabled" : ""}>
            <input
              className="catalog-name"
              defaultValue={item.name}
              disabled={busy}
              aria-label="Customer name"
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== item.name) void save(item, { name: next });
              }}
            />
            <input
              defaultValue={String(item.lat)}
              disabled={busy}
              inputMode="decimal"
              aria-label="Latitude"
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next !== item.lat) void save(item, { lat: next });
              }}
            />
            <input
              defaultValue={String(item.lon)}
              disabled={busy}
              inputMode="decimal"
              aria-label="Longitude"
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next !== item.lon) void save(item, { lon: next });
              }}
            />
            <input
              defaultValue={item.zone}
              placeholder="Zone"
              disabled={busy}
              aria-label="Zone"
              onBlur={(e) => {
                if (e.target.value.trim() !== item.zone) void save(item, { zone: e.target.value.trim() });
              }}
            />
            <input
              defaultValue={item.phone}
              placeholder="Phone"
              disabled={busy}
              aria-label="Phone"
              onBlur={(e) => {
                if (e.target.value.trim() !== item.phone) void save(item, { phone: e.target.value.trim() });
              }}
            />
            <label className="catalog-enabled">
              <input
                type="checkbox"
                checked={item.enabled}
                disabled={busy}
                onChange={(e) => void save(item, { enabled: e.target.checked })}
              />
              On
            </label>
            {onUse ? (
              <button type="button" className="btn-secondary" disabled={busy || !item.enabled} onClick={() => onUse(item)}>
                Use
              </button>
            ) : null}
            <button type="button" className="btn-ghost btn-compact" disabled={busy} onClick={() => void removeItem(item)}>
              Remove
            </button>
            <p className="dispatch-search-hint">
              {[item.address, item.contactName ? `Contact ${item.contactName}` : "", item.notes].filter(Boolean).join(" · ") ||
                "No address or notes"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
