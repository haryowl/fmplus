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
  fetchDispatchCostRates,
  fetchDispatchDepots,
  fetchDispatchGoods,
  fetchDispatchStock,
  formatGoodsPackHint,
  goodsUnitIsPackable,
  groupTruckStockByJob,
  importDispatchGoods,
  patchDispatchGoodsItem,
  returnDispatchJobStock,
  saveDispatchCostRates,
  type DispatchCostRates,
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
  const [returnDepotId, setReturnDepotId] = useState("");
  const [costRates, setCostRates] = useState<DispatchCostRates[]>([]);
  const [rateDepotId, setRateDepotId] = useState("");
  const [rateKm, setRateKm] = useState("0");
  const [rateStop, setRateStop] = useState("0");
  const [rateHour, setRateHour] = useState("0");
  const [rateFixed, setRateFixed] = useState("0");

  function applyRateForm(rates: DispatchCostRates[], depotId: string) {
    const row =
      rates.find((r) => (depotId ? r.depotId === depotId : !r.depotId)) ||
      (!depotId ? rates.find((r) => !r.depotId) : null);
    setRateKm(String(row?.rateKm ?? 0));
    setRateStop(String(row?.rateStop ?? 0));
    setRateHour(String(row?.rateHour ?? 0));
    setRateFixed(String(row?.fixedTrip ?? 0));
  }

  async function reloadStock(signal?: AbortSignal) {
    const [depotList, stock, rates] = await Promise.all([
      fetchDispatchDepots(),
      fetchDispatchStock({ signal }),
      fetchDispatchCostRates(signal).catch(() => [] as DispatchCostRates[]),
    ]);
    setDepots(depotList);
    setBalances(stock.balances);
    setTruck(stock.truck);
    setStockSettings(stock.settings);
    setCostRates(rates);
    if (!adjustDepotId) {
      const def = depotList.find((d) => d.isDefault) || depotList[0];
      if (def) setAdjustDepotId(def.id);
    }
    if (!returnDepotId) {
      const def = depotList.find((d) => d.isDefault) || depotList[0];
      if (def) setReturnDepotId(def.id);
    }
    applyRateForm(rates, rateDepotId);
  }

  async function closeJobTruck(jobId: string, writeOff: boolean) {
    if (writeOff) {
      const ok = window.confirm(
        "Write off all in-transit stock on this job? Qty is not returned to sellable depot stock.",
      );
      if (!ok) return;
    }
    setBusy(true);
    setError("");
    try {
      await returnDispatchJobStock(jobId, {
        depotId: writeOff ? undefined : returnDepotId || undefined,
        writeOff,
        note: writeOff ? "Goods desk write-off" : "Goods desk return truck → depot",
      });
      await reloadStock();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Truck stock update failed");
    } finally {
      setBusy(false);
    }
  }

  async function reload(signal?: AbortSignal) {
    setItems(await fetchDispatchGoods(signal));
    await reloadStock(signal).catch(() => undefined);
  }

  async function saveRates(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { rates } = await saveDispatchCostRates({
        depotId: rateDepotId || null,
        rateKm: Number(rateKm) || 0,
        rateStop: Number(rateStop) || 0,
        rateHour: Number(rateHour) || 0,
        fixedTrip: Number(rateFixed) || 0,
      });
      setCostRates(rates);
      applyRateForm(rates, rateDepotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save cost rates failed");
    } finally {
      setBusy(false);
    }
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
  const truckByJob = groupTruckStockByJob(truck);

  return (
    <section
      className={`dispatch-goods-catalog${onClose ? " is-dialog" : ""}${asPage ? " is-master-desk" : ""}`}
    >
      {!asPage ? (
        <div className="dispatch-goods-catalog-head">
          <div>
            <p className="dispatch-eyebrow">Cargo</p>
            <h2>Goods &amp; Stock</h2>
            <p className="dispatch-search-hint">
              Sell/cost are IDR per unit. Stock is per depot; catalog on-hand is the sum of depot balances.
            </p>
          </div>
          {onClose ? (
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      ) : (
        <p className="master-policy-note">
          Stock policy: {stockSettings.stockHardBlock ? "hard-block" : "warn"} when short ·{" "}
          {stockSettings.stockRequireScan ? "scan required to move" : "Finish can move stock"} · catalog on-hand =
          depot sum
        </p>
      )}
      {error ? (
        <p className="dispatch-window-warn" role="alert">
          {error}
        </p>
      ) : null}
      {truckByJob.length ? (
        <div className="dispatch-goods-stock dispatch-goods-truck-close">
          <p className="dispatch-eyebrow">Day-close · truck by job</p>
          <p className="dispatch-search-hint">
            Return leftover in-transit qty to a depot, or write off damaged/lost stock.
          </p>
          {depots.length ? (
            <label className="field">
              Return depot
              <select
                value={returnDepotId}
                disabled={busy}
                onChange={(e) => setReturnDepotId(e.target.value)}
              >
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.isDefault ? " · default" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="dispatch-search-hint">Add a depot before returning truck stock.</p>
          )}
          <ul className="dispatch-goods-stock-list">
            {truckByJob.map((g) => (
              <li key={g.jobId}>
                <strong>{g.jobTitle}</strong>
                <span>
                  {g.lines
                    .map((t) => {
                      const item = items.find((it) => it.id === t.catalogItemId);
                      const name = t.itemName || item?.name || t.itemSku || "SKU";
                      const unit = t.unit || item?.unit || "pcs";
                      return `${t.qty} ${unit} ${name}`;
                    })
                    .join(" · ")}
                </span>
                <span className="dispatch-cap-edit-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !depots.length}
                    onClick={() => void closeJobTruck(g.jobId, false)}
                  >
                    Return
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void closeJobTruck(g.jobId, true)}
                  >
                    Write off
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="master-card">
        <p className="master-card-kicker">Add product — inline</p>
        <form className="master-add-form is-goods" onSubmit={addItem}>
          <label className="master-field is-name">
            <span>Product name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>SKU</span>
            <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU" disabled={busy} />
          </label>
          <label className="master-field">
            <span>Unit</span>
            <select
              value={unit}
              onChange={(e) => {
                const next = e.target.value as DispatchGoodsUnit;
                setUnit(next);
                if (!goodsUnitIsPackable(next)) setUnitsPerPack("");
              }}
              disabled={busy}
            >
              {DISPATCH_GOODS_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          {goodsUnitIsPackable(unit) ? (
            <label className="master-field">
              <span>Pcs / unit</span>
              <input
                value={unitsPerPack}
                onChange={(e) => setUnitsPerPack(e.target.value)}
                placeholder="0"
                inputMode="decimal"
                disabled={busy}
              />
            </label>
          ) : null}
          <label className="master-field">
            <span>Sell Rp</span>
            <input
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              placeholder="0"
              inputMode="numeric"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>Cost Rp</span>
            <input
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
              placeholder="0"
              inputMode="numeric"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>m³</span>
            <input
              value={vol}
              onChange={(e) => setVol(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>kg</span>
            <input
              value={wt}
              onChange={(e) => setWt(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              disabled={busy}
            />
          </label>
          <label className="master-field">
            <span>On hand</span>
            <input
              value={onHand}
              onChange={(e) => setOnHand(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              disabled={busy}
            />
          </label>
          <div className="master-add-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              + Add product
            </button>
          </div>
        </form>
      </div>

      <div className="master-toolbar">
        <input
          type="search"
          className="master-search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter name or SKU…"
          autoComplete="off"
          aria-label="Filter catalog"
        />
        <div className="master-toolbar-actions">
          <CsvImportPanel
            title="Import"
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
              Export
            </button>
          ) : null}
          <span className="master-count">
            {shown.length} item{shown.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {loading ? <p className="dispatch-search-hint">Loading catalog…</p> : null}
      {!loading && shown.length === 0 ? (
        <p className="dispatch-search-hint">No goods yet. Add a name to start the list.</p>
      ) : (
        <div className="master-table-wrap">
          <div className="master-table-head is-goods" role="row">
            <span>Name</span>
            <span>SKU</span>
            <span>Unit</span>
            <span>Sell Rp</span>
            <span>Cost Rp</span>
            <span>On hand</span>
            <span>Actions</span>
          </div>
          <ul className="master-table-list dispatch-goods-catalog-list">
            {shown.map((item) => {
              const packHint = formatGoodsPackHint(item.unit, item.unitsPerPack);
              const hand = item.onHand ?? 0;
              return (
                <li
                  key={item.id}
                  className={`master-table-row is-goods${item.enabled ? "" : " is-disabled"}`}
                >
                  <div className="master-cell-primary">
                    <strong>{item.name}</strong>
                    <p className="master-cell-meta">
                      {[
                        packHint,
                        item.volumeM3Each != null ? `${item.volumeM3Each} m³` : "",
                        item.weightKgEach != null ? `${item.weightKgEach} kg` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <input
                    key={`${item.id}-sku-${item.sku || ""}`}
                    className="master-pill-input"
                    defaultValue={item.sku || ""}
                    placeholder="SKU"
                    disabled={busy}
                    aria-label="SKU"
                    onBlur={(e) => {
                      const nextSku = e.target.value.trim();
                      if (nextSku !== (item.sku || "")) void saveItem(item, { sku: nextSku });
                    }}
                  />
                  <select
                    className="master-inline-input"
                    value={item.unit}
                    disabled={busy}
                    aria-label="Unit (qty)"
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
                  <input
                    key={`${item.id}-sell-${item.sellPrice ?? ""}`}
                    className="master-inline-input"
                    defaultValue={item.sellPrice ?? ""}
                    placeholder="0"
                    inputMode="numeric"
                    disabled={busy}
                    aria-label="Sell price IDR"
                    onBlur={(e) => {
                      const next = e.target.value === "" ? null : Number(e.target.value);
                      if (next !== (item.sellPrice ?? null)) void saveItem(item, { sellPrice: next });
                    }}
                  />
                  <input
                    key={`${item.id}-cost-${item.costPrice ?? ""}`}
                    className="master-inline-input"
                    defaultValue={item.costPrice ?? ""}
                    placeholder="0"
                    inputMode="numeric"
                    disabled={busy}
                    aria-label="Cost price IDR"
                    onBlur={(e) => {
                      const next = e.target.value === "" ? null : Number(e.target.value);
                      if (next !== (item.costPrice ?? null)) void saveItem(item, { costPrice: next });
                    }}
                  />
                  <span className={`master-stock-pill${hand > 0 ? " is-ok" : ""}`}>
                    {hand > 0 ? `+ ${hand}` : "0"} in stock
                  </span>
                  <div className="master-row-actions dispatch-goods-catalog-actions">
                    <button
                      type="button"
                      className="master-icon-btn"
                      disabled={busy}
                      title={item.enabled ? "Disable" : "Enable"}
                      aria-label={item.enabled ? "Disable" : "Enable"}
                      onClick={() => void saveItem(item, { enabled: !item.enabled })}
                    >
                      {item.enabled ? "●" : "○"}
                    </button>
                    <button
                      type="button"
                      className="master-icon-btn"
                      disabled={busy}
                      aria-label="Delete"
                      onClick={() => void removeItem(item)}
                    >
                      ⌫
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
                      className="master-icon-btn"
                      onClick={() => setOpenCodes((id) => (id === item.id ? null : item.id))}
                      aria-label={openCodes === item.id ? "Hide codes" : "Codes"}
                    >
                      #
                    </button>
                    <button
                      type="button"
                      className="btn-secondary master-stock-btn"
                      onClick={() => {
                        setOpenStock((id) => (id === item.id ? null : item.id));
                        setAdjustQty("");
                        setAdjustNote("");
                      }}
                    >
                      {openStock === item.id ? "Hide" : "Stock"}
                    </button>
                  </div>
                {openStock === item.id ? (
                  <div className="dispatch-goods-stock master-row-expand">
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
                  <div className="master-row-expand">
                    <CatalogCodesEditor
                      kind="goods"
                      itemId={item.id}
                      sku={item.sku}
                      name={item.name}
                      disabled={busy}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
          </ul>
        </div>
      )}

      {asPage ? (
        <div className="dispatch-opex-rates master-card">
          <p className="dispatch-eyebrow">Operating cost rates</p>
          <p className="dispatch-search-hint">
            Global rates apply when a depot has none. Used for job opex estimate (after plan/optimize) and actual
            (after job done).
          </p>
          <form className="dispatch-opex-rates-form" onSubmit={(e) => void saveRates(e)}>
            <div className="field">
              <label htmlFor="opex-rate-depot">Scope</label>
              <select
                id="opex-rate-depot"
                value={rateDepotId}
                disabled={busy}
                onChange={(e) => {
                  const id = e.target.value;
                  setRateDepotId(id);
                  applyRateForm(costRates, id);
                }}
              >
                <option value="">Global (all depots)</option>
                {depots.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.isDefault ? " · default" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="opex-rate-km">Rp / km</label>
              <input
                id="opex-rate-km"
                type="number"
                min="0"
                step="1"
                value={rateKm}
                disabled={busy}
                onChange={(e) => setRateKm(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="opex-rate-stop">Rp / stop</label>
              <input
                id="opex-rate-stop"
                type="number"
                min="0"
                step="1"
                value={rateStop}
                disabled={busy}
                onChange={(e) => setRateStop(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="opex-rate-hour">Rp / hour</label>
              <input
                id="opex-rate-hour"
                type="number"
                min="0"
                step="1"
                value={rateHour}
                disabled={busy}
                onChange={(e) => setRateHour(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="opex-rate-fixed">Fixed / trip</label>
              <input
                id="opex-rate-fixed"
                type="number"
                min="0"
                step="1"
                value={rateFixed}
                disabled={busy}
                onChange={(e) => setRateFixed(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={busy}>
              Save rates
            </button>
          </form>
          {costRates.length ? (
            <ul className="dispatch-opex-rates-list">
              {costRates.map((r) => (
                <li key={r.id || r.depotId || "global"}>
                  <span>{r.depotId ? r.depotName || "Depot" : "Global"}</span>
                  <span>
                    {formatIdr(r.rateKm)}/km · {formatIdr(r.rateStop)}/stop · {formatIdr(r.rateHour)}/h ·{" "}
                    {formatIdr(r.fixedTrip)} fixed
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dispatch-search-hint">No rates saved yet — estimate/actual stay 0 until you set them.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
