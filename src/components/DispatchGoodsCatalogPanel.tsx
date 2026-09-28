import { useEffect, useState, type FormEvent } from "react";
import { CsvImportPanel } from "./CsvImportPanel";
import {
  DISPATCH_GOODS_CSV_HEADERS,
  dispatchGoodsCsvFromItems,
  dispatchGoodsCsvTemplate,
  downloadCsv,
  parseCsv,
} from "../lib/csvImport";
import { printCatalogLabel } from "../lib/catalogCodes";
import { CatalogCodesEditor } from "./CatalogCodesEditor";
import { CatalogNfcWriteButton } from "./CatalogNfcWriteButton";
import {
  createDispatchGoodsItem,
  deleteDispatchGoodsItem,
  DISPATCH_GOODS_UNITS,
  fetchDispatchGoods,
  importDispatchGoods,
  patchDispatchGoodsItem,
  type DispatchGoodsItem,
  type DispatchGoodsUnit,
} from "../lib/dispatch";

type Props = {
  onClose?: () => void;
};

export function DispatchGoodsCatalogPanel({ onClose }: Props) {
  const [items, setItems] = useState<DispatchGoodsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState<DispatchGoodsUnit>("pcs");
  const [vol, setVol] = useState("");
  const [wt, setWt] = useState("");
  const [onHand, setOnHand] = useState("");
  const [filter, setFilter] = useState("");
  const [openCodes, setOpenCodes] = useState<string | null>(null);

  async function reload(signal?: AbortSignal) {
    setItems(await fetchDispatchGoods(signal));
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
    const nextName = name.trim();
    if (!nextName) return;
    setBusy(true);
    setError("");
    try {
      const created = await createDispatchGoodsItem({
        name: nextName,
        sku: sku.trim() || undefined,
        unit,
        volumeM3Each: vol === "" ? null : Number(vol),
        weightKgEach: wt === "" ? null : Number(wt),
        onHand: onHand === "" ? null : Number(onHand),
      });
      setName("");
      setSku("");
      setVol("");
      setWt("");
      setOnHand("");
      await reload();
      if (created.sku) setOpenCodes(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveItem(item: DispatchGoodsItem, patch: Partial<DispatchGoodsItem>) {
    setBusy(true);
    setError("");
    try {
      await patchDispatchGoodsItem(item.id, patch);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: DispatchGoodsItem) {
    if (!window.confirm(`Remove “${item.name}” from the goods catalog?`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteDispatchGoodsItem(item.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const shown = items.filter((it) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q);
  });

  return (
    <section className={`dispatch-goods-catalog${onClose ? " is-dialog" : ""}`}>
      <div className="dispatch-goods-catalog-head">
        <div>
          <p className="dispatch-eyebrow">Cargo</p>
          <h2>Goods catalog</h2>
          <p className="dispatch-search-hint">
            Office list. Fill a SKU, then Print QR / barcode or Write NFC. Orders can also pick free text.
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
      <form className="dispatch-goods-catalog-add" onSubmit={addItem}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          disabled={busy}
          size={1}
        />
        <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" disabled={busy} size={1} />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as DispatchGoodsUnit)}
          disabled={busy}
          aria-label="Unit"
        >
          {DISPATCH_GOODS_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <input
          value={vol}
          onChange={(e) => setVol(e.target.value)}
          placeholder="m³ each"
          inputMode="decimal"
          disabled={busy}
          size={1}
        />
        <input
          value={wt}
          onChange={(e) => setWt(e.target.value)}
          placeholder="kg each"
          inputMode="decimal"
          disabled={busy}
          size={1}
        />
        <input
          value={onHand}
          onChange={(e) => setOnHand(e.target.value)}
          placeholder="On hand"
          inputMode="decimal"
          disabled={busy}
          size={1}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>
      <div className="dispatch-goods-catalog-tools">
        <CsvImportPanel
          title="Import goods CSV"
          disabled={busy}
          templateFilename="dispatch-goods-template.csv"
          hint="Required: name. Include sku to print QR/barcode and scan later. Optional: unit (pcs/box/bag/kg/L), volume_m3_each, weight_kg_each, on_hand, enabled. Matching SKU or name updates the existing item. Max 500 rows."
          onDownloadTemplate={() => downloadCsv("dispatch-goods-template.csv", dispatchGoodsCsvTemplate())}
          parseFile={(text) => {
            const { headers, rows } = parseCsv(text);
            if (!headers.includes("name")) {
              return { rows: [], error: "CSV must include name column" };
            }
            const missing = DISPATCH_GOODS_CSV_HEADERS.filter((h) => h === "name").filter(
              (h) => !headers.includes(h),
            );
            if (missing.length) return { rows: [], error: `Missing columns: ${missing.join(", ")}` };
            if (!rows.length) return { rows: [], error: "No data rows found" };
            if (rows.length > 500) return { rows: [], error: "Maximum 500 rows per import" };
            return { rows };
          }}
          onImport={async (rows) => {
            setBusy(true);
            setError("");
            try {
              const out = await importDispatchGoods({ rows });
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
            onClick={() => downloadCsv("dispatch-goods.csv", dispatchGoodsCsvFromItems(items))}
          >
            Export goods CSV
          </button>
        ) : null}
      </div>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter catalog…"
        autoComplete="off"
        size={1}
      />
      {loading ? <p className="dispatch-search-hint">Loading catalog…</p> : null}
      {!loading && shown.length === 0 ? (
        <p className="dispatch-search-hint">No goods yet. Add a name to start the list.</p>
      ) : (
        <ul className="dispatch-goods-catalog-list">
          {shown.map((item) => (
            <li key={item.id} className={item.enabled ? undefined : "is-disabled"}>
              <strong>{item.name}</strong>
              <input
                key={`${item.id}-sku-${item.sku || ""}`}
                defaultValue={item.sku || ""}
                placeholder="SKU"
                disabled={busy}
                size={8}
                onBlur={(e) => {
                  const sku = e.target.value.trim();
                  if (sku !== (item.sku || "")) void saveItem(item, { sku });
                }}
              />
              <input
                key={`${item.id}-onhand-${item.onHand ?? ""}`}
                defaultValue={item.onHand ?? ""}
                placeholder="On hand"
                inputMode="decimal"
                disabled={busy}
                size={6}
                onBlur={(e) => {
                  const next = e.target.value === "" ? null : Number(e.target.value);
                  if (next !== (item.onHand ?? null)) void saveItem(item, { onHand: next });
                }}
              />
              <span>
                {item.unit}
                {item.volumeM3Each != null ? ` · ${item.volumeM3Each} m³` : ""}
                {item.weightKgEach != null ? ` · ${item.weightKgEach} kg` : ""}
              </span>
              <div className="dispatch-goods-catalog-actions">
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  disabled={busy}
                  onClick={() => void saveItem(item, { enabled: !item.enabled })}
                >
                  {item.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  disabled={busy}
                  onClick={() => void removeItem(item)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  disabled={busy || !item.sku}
                  title={item.sku ? "Print QR and barcode" : "Add a SKU to print"}
                  onClick={() => printCatalogLabel("goods", item.name, item.sku)}
                >
                  Print QR / barcode
                </button>
                <CatalogNfcWriteButton kind="goods" name={item.name} sku={item.sku || ""} disabled={busy} />
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={() => setOpenCodes((id) => (id === item.id ? null : item.id))}
                >
                  {openCodes === item.id ? "Hide codes" : "Codes"}
                </button>
              </div>
              {openCodes === item.id ? (
                <CatalogCodesEditor
                  kind="goods"
                  itemId={item.id}
                  sku={item.sku}
                  name={item.name}
                  disabled={busy}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
