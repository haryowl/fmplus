import { useEffect, useState, type FormEvent } from "react";
import { CsvImportPanel } from "./CsvImportPanel";
import {
  DISPATCH_GOODS_CSV_HEADERS,
  dispatchGoodsCsvFromItems,
  dispatchGoodsCsvTemplate,
  downloadCsv,
  parseCsv,
} from "../lib/csvImport";
import { CatalogCodesEditor } from "./CatalogCodesEditor";
import { CatalogLabelPrintButton } from "./CatalogLabelPrintButton";
import { CatalogNfcWriteButton } from "./CatalogNfcWriteButton";
import { formatIdr } from "../lib/format";
import {
  adjustDispatchStock,
  createDispatchGoodsItem,
  deleteDispatchGoodsItem,
  DISPATCH_GOODS_UNITS,
  fetchDispatchDepots,
  fetchDispatchGoods,
  fetchDispatchStock,
  formatGoodsPackHint,
  goodsUnitIsPackable,
  importDispatchGoods,
  patchDispatchGoodsItem,
  type DispatchDepot,
  type DispatchGoodsItem,
  type DispatchGoodsUnit,
  type DispatchStockBalance,
  type DispatchStockSettings,
  type DispatchTruckStock,
} from "../lib/dispatch";

type Props = {
  onClose?: () => void;
};

export function DispatchGoodsCatalogPanel({ onClose }: Props) {
  const asPage = !onClose;
  const [items, setItems] = useState<DispatchGoodsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState<DispatchGoodsUnit>("pcs");
  const [unitsPerPack, setUnitsPerPack] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [vol, setVol] = useState("");
  const [wt, setWt] = useState("");
  const [onHand, setOnHand] = useState("");
  const [filter, setFilter] = useState("");
  const [openCodes, setOpenCodes] = useState<string | null>(null);
  const [openStock, setOpenStock] = useState<string | null>(null);
  const [depots, setDepots] = useState<DispatchDepot[]>([]);
  const [balances, setBalances] = useState<DispatchStockBalance[]>([]);
  const [truck, setTruck] = useState<DispatchTruckStock[]>([]);
  const [stockSettings, setStockSettings] = useState<DispatchStockSettings>({
    stockHardBlock: false,
    stockRequireScan: false,
  });
  const [adjustDepotId, setAdjustDepotId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustKind, setAdjustKind] = useState<"receive" | "adjust" | "write_off">("receive");

  async function reloadStock(signal?: AbortSignal) {
    const [depotList, stock] = await Promise.all([
      fetchDispatchDepots(),
      fetchDispatchStock({ signal }),
    ]);
    setDepots(depotList);
    setBalances(stock.balances);
    setTruck(stock.truck);
    setStockSettings(stock.settings);
    if (!adjustDepotId) {
      const def = depotList.find((d) => d.isDefault) || depotList[0];
      if (def) setAdjustDepotId(def.id);
    }
  }

  async function reload(signal?: AbortSignal) {
    setItems(await fetchDispatchGoods(signal));
    await reloadStock(signal).catch(() => undefined);
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
        unitsPerPack:
          goodsUnitIsPackable(unit) && unitsPerPack !== "" ? Number(unitsPerPack) : null,
        sellPrice: sellPrice === "" ? null : Number(sellPrice),
        costPrice: costPrice === "" ? null : Number(costPrice),
        volumeM3Each: vol === "" ? null : Number(vol),
        weightKgEach: wt === "" ? null : Number(wt),
        onHand: onHand === "" ? null : Number(onHand),
      });
      setName("");
      setSku("");
      setUnit("pcs");
      setUnitsPerPack("");
      setSellPrice("");
      setCostPrice("");
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

  const q = filter.trim().toLowerCase();
  const shown = items.filter((it) => {
    if (!q) return true;
    return [it.name, it.sku, it.unit].join(" ").toLowerCase().includes(q);
  });

  return (
    <section className={`dispatch-goods-catalog${onClose ? " is-dialog" : ""}`}>
      <div className="dispatch-goods-catalog-head">
        <div>
          {!asPage ? (
            <>
              <p className="dispatch-eyebrow">Cargo</p>
              <h2>Goods &amp; Stock</h2>
            </>
          ) : null}
          <p className="dispatch-search-hint">
            Unit (qty) is how you count the item. Sell/cost are IDR per unit (snapshotted onto order lines — not
            editable there). Stock is per depot; truck/in-transit shows after pickup moves. Catalog “On hand” is the
            sum of depot balances.
          </p>
          <p className="dispatch-search-hint">
            Stock policy: {stockSettings.stockHardBlock ? "hard-block" : "warn"} when short ·{" "}
            {stockSettings.stockRequireScan ? "scan required to move" : "Finish can move stock"} (Admin entitlements).
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
          className="catalog-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          disabled={busy}
          aria-label="Name"
        />
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="SKU"
          disabled={busy}
          aria-label="SKU"
        />
        <select
          value={unit}
          onChange={(e) => {
            const next = e.target.value as DispatchGoodsUnit;
            setUnit(next);
            if (!goodsUnitIsPackable(next)) setUnitsPerPack("");
          }}
          disabled={busy}
          aria-label="Unit (qty)"
          title="Unit (qty)"
        >
          {DISPATCH_GOODS_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {goodsUnitIsPackable(unit) ? (
          <input
            value={unitsPerPack}
            onChange={(e) => setUnitsPerPack(e.target.value)}
            placeholder="pcs / unit"
            inputMode="decimal"
            disabled={busy}
            aria-label="Pcs per unit"
            title="How many pcs in one of this unit"
          />
        ) : null}
        <input
          value={sellPrice}
          onChange={(e) => setSellPrice(e.target.value)}
          placeholder="Sell Rp"
          inputMode="numeric"
          disabled={busy}
          aria-label="Sell price IDR"
          title="Sell price (IDR per unit)"
        />
        <input
          value={costPrice}
          onChange={(e) => setCostPrice(e.target.value)}
          placeholder="Cost Rp"
          inputMode="numeric"
          disabled={busy}
          aria-label="Cost price IDR"
          title="Cost price / COGS (IDR per unit)"
        />
        <input
          value={vol}
          onChange={(e) => setVol(e.target.value)}
          placeholder="m³ / unit"
          inputMode="decimal"
          disabled={busy}
          aria-label="Volume m3 per unit"
          title="Volume each (m³) — capacity for one unit"
        />
        <input
          value={wt}
          onChange={(e) => setWt(e.target.value)}
          placeholder="kg / unit"
          inputMode="decimal"
          disabled={busy}
          aria-label="Weight kg per unit"
          title="Weight each (kg) — capacity for one unit"
        />
        <input
          value={onHand}
          onChange={(e) => setOnHand(e.target.value)}
          placeholder="On hand"
          inputMode="decimal"
          disabled={busy}
          aria-label="On hand"
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
          hint="Required: name. Include sku to print QR/barcode and scan later. Optional: unit (pcs/box/bag/carton/pack/drum/set/pair/kg/L), units_per_pack, sell_price, cost_price (IDR), volume_m3_each, weight_kg_each, on_hand, enabled. Matching SKU or name updates the existing item. Max 500 rows."
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
        aria-label="Filter catalog"
      />
      {loading ? <p className="dispatch-search-hint">Loading catalog…</p> : null}
      {!loading && shown.length === 0 ? (
        <p className="dispatch-search-hint">No goods yet. Add a name to start the list.</p>
      ) : (
        <ul className="dispatch-goods-catalog-list">
          {shown.map((item) => {
            const packHint = formatGoodsPackHint(item.unit, item.unitsPerPack);
            return (
              <li key={item.id} className={item.enabled ? undefined : "is-disabled"}>
                <strong>{item.name}</strong>
                <div className="dispatch-goods-catalog-fields">
                  <input
                    key={`${item.id}-sku-${item.sku || ""}`}
                    defaultValue={item.sku || ""}
                    placeholder="SKU"
                    disabled={busy}
                    aria-label="SKU"
                    onBlur={(e) => {
                      const sku = e.target.value.trim();
                      if (sku !== (item.sku || "")) void saveItem(item, { sku });
                    }}
                  />
                  <select
                    value={item.unit}
                    disabled={busy}
                    aria-label="Unit (qty)"
                    title="Unit (qty)"
                    onChange={(e) => {
                      const next = e.target.value as DispatchGoodsUnit;
                      void saveItem(item, {
                        unit: next,
                        unitsPerPack: goodsUnitIsPackable(next) ? item.unitsPerPack ?? null : null,
                      });
                    }}
                  >
                    {DISPATCH_GOODS_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  {goodsUnitIsPackable(item.unit) ? (
                    <input
                      key={`${item.id}-pack-${item.unitsPerPack ?? ""}`}
                      defaultValue={item.unitsPerPack ?? ""}
                      placeholder="pcs / unit"
                      inputMode="decimal"
                      disabled={busy}
                      aria-label="Pcs per unit"
                      title="How many pcs in one of this unit"
                      onBlur={(e) => {
                        const next = e.target.value === "" ? null : Number(e.target.value);
                        if (next !== (item.unitsPerPack ?? null)) {
                          void saveItem(item, { unitsPerPack: next });
                        }
                      }}
                    />
                  ) : null}
                  <input
                    key={`${item.id}-sell-${item.sellPrice ?? ""}`}
                    defaultValue={item.sellPrice ?? ""}
                    placeholder="Sell Rp"
                    inputMode="numeric"
                    disabled={busy}
                    aria-label="Sell price IDR"
                    title="Sell price (IDR per unit)"
                    onBlur={(e) => {
                      const next = e.target.value === "" ? null : Number(e.target.value);
                      if (next !== (item.sellPrice ?? null)) void saveItem(item, { sellPrice: next });
                    }}
                  />
                  <input
                    key={`${item.id}-cost-${item.costPrice ?? ""}`}
                    defaultValue={item.costPrice ?? ""}
                    placeholder="Cost Rp"
                    inputMode="numeric"
                    disabled={busy}
                    aria-label="Cost price IDR"
                    title="Cost price / COGS (IDR per unit)"
                    onBlur={(e) => {
                      const next = e.target.value === "" ? null : Number(e.target.value);
                      if (next !== (item.costPrice ?? null)) void saveItem(item, { costPrice: next });
                    }}
                  />
                  <span className="dispatch-goods-catalog-meta">
                    {[
                      packHint,
                      item.sellPrice != null ? `Sell ${formatIdr(item.sellPrice)}` : "",
                      item.costPrice != null ? `Cost ${formatIdr(item.costPrice)}` : "",
                      item.sellPrice != null && item.costPrice != null
                        ? `Margin ${formatIdr(item.sellPrice - item.costPrice)}/unit`
                        : "",
                      `On hand ${item.onHand ?? 0} ${item.unit}`,
                      item.volumeM3Each != null ? `${item.volumeM3Each} m³/unit` : "",
                      item.weightKgEach != null ? `${item.weightKgEach} kg/unit` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No price / pack / capacity attrs"}
                  </span>
                </div>
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
                  <CatalogLabelPrintButton
                    kind="goods"
                    name={item.name}
                    sku={item.sku || ""}
                    disabled={busy}
                  />
                  <CatalogNfcWriteButton kind="goods" name={item.name} sku={item.sku || ""} disabled={busy} />
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={() => setOpenCodes((id) => (id === item.id ? null : item.id))}
                  >
                    {openCodes === item.id ? "Hide codes" : "Codes"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-compact"
                    onClick={() => {
                      setOpenStock((id) => (id === item.id ? null : item.id));
                      setAdjustQty("");
                      setAdjustNote("");
                    }}
                  >
                    {openStock === item.id ? "Hide stock" : "Stock"}
                  </button>
                </div>
                {openStock === item.id ? (
                  <div className="dispatch-goods-stock">
                    {!depots.length ? (
                      <p className="dispatch-search-hint">
                        Add a depot on Jobs (Depots) before recording per-depot stock.
                      </p>
                    ) : (
                      <>
                        <ul className="dispatch-goods-stock-list">
                          {depots.map((d) => {
                            const bal = balances.find(
                              (b) => b.catalogItemId === item.id && b.depotId === d.id,
                            );
                            return (
                              <li key={d.id}>
                                <strong>{d.name}</strong>
                                <span>
                                  {bal ? bal.onHand : 0} {item.unit}
                                  {d.isDefault ? " · default" : ""}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        {truck.filter((t) => t.catalogItemId === item.id).length ? (
                          <p className="dispatch-search-hint">
                            On truck:{" "}
                            {truck
                              .filter((t) => t.catalogItemId === item.id)
                              .map((t) => `${t.qty} ${item.unit} (${t.jobTitle || "job"})`)
                              .join(" · ")}
                          </p>
                        ) : (
                          <p className="dispatch-search-hint">No truck / in-transit qty for this SKU.</p>
                        )}
                        <form
                          className="dispatch-goods-catalog-add"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const qty = Number(adjustQty);
                            if (!adjustDepotId || !Number.isFinite(qty) || qty === 0) return;
                            const delta =
                              adjustKind === "write_off" ? -Math.abs(qty) : Math.abs(qty);
                            setBusy(true);
                            setError("");
                            void adjustDispatchStock({
                              catalogItemId: item.id,
                              depotId: adjustDepotId,
                              qtyDelta: adjustKind === "adjust" ? qty : delta,
                              kind: adjustKind,
                              note: adjustNote.trim(),
                            })
                              .then(async () => {
                                setAdjustQty("");
                                setAdjustNote("");
                                await reload();
                              })
                              .catch((err: Error) => setError(err.message))
                              .finally(() => setBusy(false));
                          }}
                        >
                          <select
                            value={adjustDepotId}
                            onChange={(e) => setAdjustDepotId(e.target.value)}
                            disabled={busy}
                            aria-label="Depot"
                          >
                            {depots.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={adjustKind}
                            onChange={(e) =>
                              setAdjustKind(e.target.value as "receive" | "adjust" | "write_off")
                            }
                            disabled={busy}
                            aria-label="Adjust kind"
                          >
                            <option value="receive">Receive (+)</option>
                            <option value="adjust">Adjust (+/−)</option>
                            <option value="write_off">Write-off (−)</option>
                          </select>
                          <input
                            value={adjustQty}
                            onChange={(e) => setAdjustQty(e.target.value)}
                            placeholder={adjustKind === "adjust" ? "± qty" : "Qty"}
                            inputMode="decimal"
                            disabled={busy}
                            aria-label="Quantity"
                          />
                          <input
                            value={adjustNote}
                            onChange={(e) => setAdjustNote(e.target.value)}
                            placeholder="Note"
                            disabled={busy}
                            aria-label="Note"
                          />
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={busy || !adjustDepotId || !adjustQty.trim()}
                          >
                            Apply
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                ) : null}
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
            );
          })}
        </ul>
      )}
    </section>
  );
}
