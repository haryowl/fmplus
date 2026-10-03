import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { printCatalogLabel } from "../lib/catalogCodes";
import {
  downloadCsv,
  maintenanceCatalogCsvFromGroups,
  maintenanceCatalogCsvTemplate,
  parseCsv,
} from "../lib/csvImport";
import { formatIdr } from "../lib/format";
import { CatalogCodesEditor } from "./CatalogCodesEditor";
import { CatalogNfcWriteButton } from "./CatalogNfcWriteButton";
import { CsvImportPanel } from "./CsvImportPanel";
import {
  createMaintCatalogItem,
  deleteMaintCatalogItem,
  fetchMaintenanceCatalog,
  importMaintCatalog,
  patchMaintCatalogItem,
  type CatalogGroup,
  type CatalogItem,
} from "../lib/maintenance";

type Props = {
  onClose?: () => void;
};

type TabKey = "part" | "service" | "other";

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return formatIdr(Number(n));
}

function EditableValue({
  value,
  display,
  className,
  disabled,
  inputMode,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string;
  display: ReactNode;
  className?: string;
  disabled?: boolean;
  inputMode?: "text" | "decimal";
  placeholder?: string;
  ariaLabel: string;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {display}
      </button>
    );
  }

  return (
    <input
      autoFocus
      className={className}
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      inputMode={inputMode}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="catalog-v2-icon-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function MaintenanceCatalogPanel({ onClose }: Props) {
  const [groups, setGroups] = useState<CatalogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>("part");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [openCodes, setOpenCodes] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newSku, setNewSku] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCost, setNewCost] = useState("");

  async function reload(signal?: AbortSignal) {
    const next = await fetchMaintenanceCatalog(signal);
    setGroups(next);
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

  const group = groups.find((g) => g.key === tab) || null;
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const list = group?.items || [];
    if (!q) return list;
    return list.filter((item) => item.name.toLowerCase().includes(q) || (item.sku || "").toLowerCase().includes(q));
  }, [group, q]);

  const counts = {
    part: groups.find((g) => g.key === "part")?.items.length || 0,
    service: groups.find((g) => g.key === "service")?.items.length || 0,
    other: 0,
  };
  const activeCount = items.filter((item) => item.enabled).length;
  const skuCount = items.filter((item) => item.sku).length;

  async function addItem(e: FormEvent) {
    e.preventDefault();
    if (!group || group.key === "other") return;
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const created = await createMaintCatalogItem({
        groupId: group.id,
        name,
        sku: group.key === "part" ? newSku.trim() : undefined,
        unitPrice: newPrice === "" ? null : Number(newPrice),
        unitCost: newCost === "" ? null : Number(newCost),
      });
      setNewName("");
      setNewSku("");
      setNewPrice("");
      setNewCost("");
      await reload();
      if (group.key === "part" && created.sku) setOpenCodes(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(item: CatalogItem, patch: Partial<CatalogItem>) {
    setBusy(true);
    setError("");
    try {
      await patchMaintCatalogItem(item.id, patch);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: CatalogItem) {
    if (!window.confirm(`Remove “${item.name}” from catalog?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteMaintCatalogItem(item.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  function commitNumber(item: CatalogItem, field: "unitPrice" | "unitCost" | "onHand", raw: string) {
    const next = raw.trim() === "" ? null : Number(raw);
    if (next != null && !Number.isFinite(next)) return;
    const current = item[field] ?? null;
    if (next !== current) void saveItem(item, { [field]: next });
  }

  return (
    <section className="maintenance-catalog-panel catalog-v2">
      <div className="catalog-v2-head">
        <div className="catalog-v2-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path d="M12 11.5V20M4.5 8 12 11.5 19.5 8" fill="none" stroke="currentColor" strokeWidth="1.7" />
          </svg>
        </div>
        <div className="catalog-v2-title">
          <h2>Parts &amp; service catalog</h2>
          <p>
            Defaults for job lines. On Part, fill a SKU then Print QR / barcode or Write NFC. Others is always free
            text.
          </p>
        </div>
        {onClose ? (
          <button type="button" className="catalog-v2-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>

      <p className="catalog-v2-note">
        <strong>How defaults work:</strong> items toggled On appear as quick-selects on job lines. Fill a SKU to enable
        QR / NFC. Price and cost are the job-line defaults unless a job overrides them.
      </p>

      <div className="catalog-v2-toolbar">
        <div className="catalog-v2-toolbar-actions">
          <CsvImportPanel
            title="Import CSV"
            disabled={busy || loading}
            templateFilename="maintenance-catalog-template.csv"
            hint="Required: kind (part or service) and name. Matching SKU or name in that kind updates the row. Part rows can include sku and on_hand. Optional: unit_price, unit_cost, enabled. Others stays free text. Max 500 rows."
            onDownloadTemplate={() =>
              downloadCsv("maintenance-catalog-template.csv", maintenanceCatalogCsvTemplate())
            }
            parseFile={(text) => {
              const { headers, rows } = parseCsv(text);
              const missing = ["kind", "name"].filter((h) => !headers.includes(h));
              if (missing.length) return { rows: [], error: `Missing columns: ${missing.join(", ")}` };
              if (!rows.length) return { rows: [], error: "No data rows found" };
              if (rows.length > 500) return { rows: [], error: "Maximum 500 rows per import" };
              return { rows };
            }}
            onImport={async (rows) => {
              setBusy(true);
              setError("");
              try {
                const out = await importMaintCatalog({ rows });
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
          <button
            type="button"
            className="catalog-v2-pill"
            disabled={busy}
            onClick={() => downloadCsv("maintenance-catalog.csv", maintenanceCatalogCsvFromGroups(groups))}
          >
            Export CSV
          </button>
          <div className="catalog-v2-view" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
              List
            </button>
            <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              Grid
            </button>
          </div>
        </div>
        <label className="catalog-v2-search">
          <span className="sr-only">Search catalog</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search catalog..."
            autoComplete="off"
          />
        </label>
      </div>

      <div className="catalog-v2-tabs" role="tablist">
        {(
          [
            ["part", "Parts"],
            ["service", "Services"],
            ["other", "Others"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "is-on" : ""}
            onClick={() => setTab(key)}
          >
            {label}
            <span>{counts[key]}</span>
          </button>
        ))}
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading catalog…</p> : null}

      {!loading && tab === "other" ? (
        <div className="catalog-v2-empty">
          <h3>No preset items</h3>
          <p>Others has no preset items. Technicians enter free text on the job.</p>
        </div>
      ) : null}

      {!loading && group && tab !== "other" && view === "list" ? (
        <div className="catalog-v2-table" role="table">
          <div className={tab === "part" ? "catalog-v2-cols is-part" : "catalog-v2-cols is-service"} role="row">
            <span>{tab === "part" ? "Item" : "Service name"}</span>
            {tab === "part" ? (
              <>
                <span>SKU</span>
                <span>Inventory</span>
              </>
            ) : null}
            <span>Pricing</span>
            <span>Status</span>
            <span className="is-end">Actions</span>
          </div>
          {items.length === 0 ? <p className="catalog-v2-none">{q ? "No matches." : "No items yet."}</p> : null}
          <ul className="catalog-v2-list">
            {items.map((item) => (
              <li key={item.id} className={!item.enabled ? "is-off" : ""}>
                <div className={tab === "part" ? "catalog-v2-row is-part" : "catalog-v2-row is-service"} role="row">
                  <div className="catalog-v2-item">
                    <span className="catalog-v2-avatar" aria-hidden="true">
                      {item.name.slice(0, 1).toUpperCase() || "·"}
                    </span>
                    <EditableValue
                      className="catalog-v2-name"
                      ariaLabel="Name"
                      value={item.name}
                      display={item.name || "—"}
                      disabled={busy}
                      onCommit={(name) => {
                        const next = name.trim();
                        if (next && next !== item.name) void saveItem(item, { name: next });
                      }}
                    />
                  </div>
                  {tab === "part" ? (
                    <>
                      <div className="catalog-v2-sku">
                        <EditableValue
                          className="catalog-v2-sku-pill"
                          ariaLabel="SKU"
                          value={item.sku || ""}
                          display={item.sku || "—"}
                          disabled={busy}
                          placeholder="SKU"
                          onCommit={(sku) => {
                            const next = sku.trim();
                            if (next !== (item.sku || "")) void saveItem(item, { sku: next });
                          }}
                        />
                        <button
                          type="button"
                          className="catalog-v2-codes"
                          onClick={() => setOpenCodes((id) => (id === item.id ? null : item.id))}
                        >
                          {openCodes === item.id ? "Hide codes" : "Codes"}
                        </button>
                      </div>
                      <EditableValue
                        className="catalog-v2-stock"
                        ariaLabel="On hand"
                        inputMode="decimal"
                        value={item.onHand == null ? "" : String(item.onHand)}
                        display={item.onHand == null ? "—" : `${item.onHand} on hand`}
                        disabled={busy}
                        placeholder="On hand"
                        onCommit={(raw) => commitNumber(item, "onHand", raw)}
                      />
                    </>
                  ) : null}
                  <div className="catalog-v2-money">
                    <EditableValue
                      className="catalog-v2-price"
                      ariaLabel="Price"
                      inputMode="decimal"
                      value={item.unitPrice == null ? "" : String(item.unitPrice)}
                      display={money(item.unitPrice)}
                      disabled={busy}
                      placeholder="Price"
                      onCommit={(raw) => commitNumber(item, "unitPrice", raw)}
                    />
                    <EditableValue
                      className="catalog-v2-cost"
                      ariaLabel="Cost"
                      inputMode="decimal"
                      value={item.unitCost == null ? "" : String(item.unitCost)}
                      display={item.unitCost == null ? "— cost" : `${money(item.unitCost)} cost`}
                      disabled={busy}
                      placeholder="Cost"
                      onCommit={(raw) => commitNumber(item, "unitCost", raw)}
                    />
                  </div>
                  <button
                    type="button"
                    className={item.enabled ? "catalog-v2-switch is-on" : "catalog-v2-switch"}
                    role="switch"
                    aria-checked={item.enabled}
                    aria-label={item.enabled ? "On" : "Off"}
                    disabled={busy}
                    onClick={() => void saveItem(item, { enabled: !item.enabled })}
                  >
                    <span />
                    {item.enabled ? "On" : "Off"}
                  </button>
                  <div className="catalog-v2-actions">
                    {tab === "part" ? (
                      <>
                        <IconButton
                          label={item.sku ? "Print QR / barcode" : "Add a SKU to print"}
                          disabled={busy || !item.sku}
                          onClick={() => printCatalogLabel("maint_part", item.name, item.sku || "")}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M4 8V5h3M16 5h3v3M20 16v3h-3M8 19H5v-3M7 7h4v4H7V7Zm6 0h4v4h-4V7ZM7 13h4v4H7v-4Zm6 2h2v2h-2v-2Zm2-2h2v2h-2v-2Z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                            />
                          </svg>
                        </IconButton>
                        <CatalogNfcWriteButton
                          compact
                          kind="maint_part"
                          name={item.name}
                          sku={item.sku || ""}
                          disabled={busy}
                        />
                      </>
                    ) : null}
                    <IconButton label="Remove" disabled={busy} onClick={() => void removeItem(item)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                        />
                      </svg>
                    </IconButton>
                  </div>
                </div>
                {tab === "part" && openCodes === item.id ? (
                  <CatalogCodesEditor
                    kind="maint_part"
                    itemId={item.id}
                    sku={item.sku}
                    name={item.name}
                    disabled={busy}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!loading && group && tab !== "other" && view === "grid" ? (
        items.length === 0 ? (
          <p className="catalog-v2-none">{q ? "No matches." : "No items yet."}</p>
        ) : (
          <ul className="catalog-v2-grid">
            {items.map((item) => (
              <li key={item.id} className={!item.enabled ? "is-off" : ""}>
                <div className="catalog-v2-card">
                  <span className="catalog-v2-avatar" aria-hidden="true">
                    {item.name.slice(0, 1).toUpperCase() || "·"}
                  </span>
                  <EditableValue
                    className="catalog-v2-name"
                    ariaLabel="Name"
                    value={item.name}
                    display={item.name || "—"}
                    disabled={busy}
                    onCommit={(name) => {
                      const next = name.trim();
                      if (next && next !== item.name) void saveItem(item, { name: next });
                    }}
                  />
                  {tab === "part" ? (
                    <EditableValue
                      className="catalog-v2-sku-pill"
                      ariaLabel="SKU"
                      value={item.sku || ""}
                      display={item.sku || "No SKU"}
                      disabled={busy}
                      onCommit={(sku) => {
                        const next = sku.trim();
                        if (next !== (item.sku || "")) void saveItem(item, { sku: next });
                      }}
                    />
                  ) : null}
                  <EditableValue
                    className="catalog-v2-price"
                    ariaLabel="Price"
                    inputMode="decimal"
                    value={item.unitPrice == null ? "" : String(item.unitPrice)}
                    display={money(item.unitPrice)}
                    disabled={busy}
                    onCommit={(raw) => commitNumber(item, "unitPrice", raw)}
                  />
                  <button
                    type="button"
                    className={item.enabled ? "catalog-v2-switch is-on" : "catalog-v2-switch"}
                    role="switch"
                    aria-checked={item.enabled}
                    disabled={busy}
                    onClick={() => void saveItem(item, { enabled: !item.enabled })}
                  >
                    <span />
                    {item.enabled ? "On" : "Off"}
                  </button>
                  <div className="catalog-v2-actions">
                    {tab === "part" ? (
                      <IconButton
                        label={item.sku ? "Print QR / barcode" : "Add a SKU to print"}
                        disabled={busy || !item.sku}
                        onClick={() => printCatalogLabel("maint_part", item.name, item.sku || "")}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M4 8V5h3M16 5h3v3M20 16v3h-3M8 19H5v-3M7 7h4v4H7V7Zm6 0h4v4h-4V7ZM7 13h4v4H7v-4Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                        </svg>
                      </IconButton>
                    ) : null}
                    <IconButton label="Remove" disabled={busy} onClick={() => void removeItem(item)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                        />
                      </svg>
                    </IconButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {!loading && group && tab !== "other" ? (
        <form className="catalog-v2-add" onSubmit={(e) => void addItem(e)}>
          <div className="catalog-v2-add-label">
            Add new {tab === "part" ? "part" : "service"}
            <span>{tab === "part" ? "Item name · SKU · Price · Cost" : "Service name · Price · Cost"}</span>
          </div>
          <input
            placeholder={tab === "part" ? "Item name e.g. Brake Pad" : "Service name e.g. Alignment"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={busy}
          />
          {tab === "part" ? (
            <input placeholder="SKU e.g. BP-02" value={newSku} onChange={(e) => setNewSku(e.target.value)} disabled={busy} />
          ) : null}
          <input
            type="number"
            step="any"
            placeholder="Price"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            disabled={busy}
          />
          <input
            type="number"
            step="any"
            placeholder="Cost"
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="catalog-v2-add-btn" disabled={busy || !newName.trim()}>
            + Add
          </button>
        </form>
      ) : null}

      {!loading && tab !== "other" ? (
        <p className="catalog-v2-foot">
          {items.length} item{items.length === 1 ? "" : "s"} · {activeCount} active
          {tab === "part" ? ` · ${skuCount} with SKU` : ""}
          <span>Changes save when you leave a field. CSV import updates a matching SKU or name.</span>
        </p>
      ) : null}
    </section>
  );
}
