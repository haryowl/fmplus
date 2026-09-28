import { useMemo, useState } from "react";
import { CatalogScanButton } from "./CatalogScanButton";
import { CatalogUnitIdPrompt } from "./CatalogUnitIdPrompt";
import {
  applyGoodsScanResult,
  catalogConfirmPending,
  catalogExpectedLines,
  catalogLineConfirmed,
  catalogScanNeedsUnitId,
  lookupCatalogScan,
} from "../lib/catalogScan";
import type { CatalogScanResult } from "../lib/catalogScan";
import {
  DISPATCH_GOODS_UNITS,
  sumOrderCargoTotals,
  type DispatchGoodsItem,
  type DispatchGoodsUnit,
  type DispatchOrderLine,
} from "../lib/dispatch";

type Props = {
  catalog: DispatchGoodsItem[];
  lines: DispatchOrderLine[];
  onChange: (lines: DispatchOrderLine[]) => void;
  disabled?: boolean;
  compact?: boolean;
  totalsLocked?: boolean;
  onToggleLock?: (locked: boolean) => void;
  /** Field uses cookie auth; desk uses the tenant key. */
  scanSource?: "field" | "desk";
  scanAllow?: boolean;
  scanCamera?: boolean;
  scanTyped?: boolean;
  scanNfc?: boolean;
  scanSerial?: boolean;
  scanKnownSerialOnly?: boolean;
  scanConfirm?: boolean;
  scanManualAdd?: boolean;
  onScanError?: (message: string) => void;
};

function newFreeLine(): DispatchOrderLine {
  return {
    catalogItemId: null,
    name: "",
    qty: 1,
    unit: "pcs",
    volumeM3Each: null,
    weightKgEach: null,
  };
}

export function DispatchOrderGoodsEditor({
  catalog,
  lines,
  onChange,
  disabled,
  compact,
  totalsLocked,
  onToggleLock,
  scanSource,
  scanAllow = true,
  scanCamera = true,
  scanTyped = true,
  scanNfc = false,
  scanSerial = false,
  scanKnownSerialOnly = false,
  scanConfirm = false,
  scanManualAdd = true,
  onScanError,
}: Props) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{
    item: DispatchGoodsItem;
    scannedCode: string;
    codeFormat?: string;
  } | null>(null);
  const enabled = catalog.filter((i) => i.enabled !== false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enabled;
    return enabled.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.sku && i.sku.toLowerCase().includes(q)),
    );
  }, [enabled, query]);
  const totals = sumOrderCargoTotals(lines);

  function patchLine(index: number, patch: Partial<DispatchOrderLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function applyHit(item: DispatchGoodsItem, scannedCode: string, extra?: { serial?: string; lot?: string; codeFormat?: string }) {
    const result = applyGoodsScanResult(lines, item, scannedCode, {
      serialMode: scanSerial,
      serial: extra?.serial,
      lot: extra?.lot,
      codeFormat: extra?.codeFormat,
      onlyKnownSerial: scanKnownSerialOnly,
      confirmMode: scanConfirm,
    });
    if (result.error) {
      onScanError?.(result.error);
      return;
    }
    onChange(result.lines);
  }

  function onGoodsCode(code: string, res: CatalogScanResult, item: DispatchGoodsItem) {
    const scanned = res.code || code;
    if (
      catalogScanNeedsUnitId({
        sku: item.sku,
        kind: "goods",
        scannedCode: scanned,
        codeFormat: res.codeFormat,
        serialMode: scanSerial,
      })
    ) {
      setPending({ item, scannedCode: scanned, codeFormat: res.codeFormat });
      return;
    }
    applyHit(item, scanned, { codeFormat: res.codeFormat });
  }

  function addCatalog(item: DispatchGoodsItem) {
    onChange([
      ...lines,
      {
        catalogItemId: item.id,
        name: item.name,
        qty: 1,
        unit: item.unit,
        volumeM3Each: item.volumeM3Each,
        weightKgEach: item.weightKgEach,
      },
    ]);
    setQuery("");
  }

  return (
    <div className={`dispatch-goods-editor${compact ? " is-compact" : ""}`}>
      {!disabled ? (
        <div className="dispatch-goods-add">
          {scanManualAdd ? (
            <>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search catalog…"
                autoComplete="off"
                size={1}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onChange([...lines, newFreeLine()])}
              >
                Free text
              </button>
            </>
          ) : null}
          {scanSource && scanAllow ? (
            <CatalogScanButton
              disabled={disabled}
              allowCamera={scanCamera}
              allowTyped={scanTyped}
              allowNfc={scanNfc}
              onCode={(code) => {
                void lookupCatalogScan(code, "dispatch_cargo", scanSource)
                  .then((res) => {
                    if (res.match !== "goods" || !res.item || !("unit" in res.item)) {
                      onScanError?.(`Not in catalog: ${res.raw || code}`);
                      return;
                    }
                    onGoodsCode(code, res, res.item);
                  })
                  .catch((err: Error) => onScanError?.(err.message));
              }}
            />
          ) : null}
        </div>
      ) : null}
      {pending ? (
        <CatalogUnitIdPrompt
          itemName={pending.item.name}
          allowCamera={scanCamera}
          allowTyped={scanTyped}
          allowNfc={scanNfc}
          onSubmit={(serial, lot) => {
            applyHit(pending.item, pending.scannedCode, {
              serial,
              lot,
              codeFormat: pending.codeFormat,
            });
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
      {query && !disabled ? (
        <ul className="dispatch-goods-suggest">
          {filtered.length === 0 ? (
            <li className="muted">No catalog match</li>
          ) : (
            filtered.slice(0, 12).map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => addCatalog(item)}>
                  <strong>{item.name}</strong>
                  <span>
                    {item.sku ? `${item.sku} · ` : ""}
                    {item.unit}
                    {item.volumeM3Each != null ? ` · ${item.volumeM3Each} m³` : ""}
                    {item.weightKgEach != null ? ` · ${item.weightKgEach} kg` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {scanConfirm && catalogExpectedLines(lines).length ? (
        <ul className="dispatch-cargo-checklist" aria-label="Expected cargo">
          {catalogExpectedLines(lines).map((line, i) => (
            <li
              key={`${line.catalogItemId || "c"}-${line.serial || i}`}
              className={catalogLineConfirmed(line) ? "is-confirmed" : "is-pending"}
            >
              <span>
                {line.name}
                {line.serial ? ` · ${line.serial}` : ""}
              </span>
              <em>{catalogLineConfirmed(line) ? "Confirmed" : "Pending"}</em>
            </li>
          ))}
        </ul>
      ) : null}
      {scanConfirm && catalogConfirmPending(lines).length ? (
        <p className="dispatch-search-hint">
          {catalogConfirmPending(lines).length} expected item
          {catalogConfirmPending(lines).length === 1 ? "" : "s"} still pending
        </p>
      ) : null}

      {lines.length === 0 ? (
        <p className="dispatch-search-hint">
          {scanConfirm ? "No expected catalog items on this stop." : "Optional. Add catalog items or free text."}
        </p>
      ) : (
        <ul className="dispatch-goods-lines">
          {lines.map((line, i) => (
            <li key={`${line.catalogItemId || "f"}-${i}`}>
              <input
                aria-label="Item name"
                value={line.name}
                disabled={disabled}
                onChange={(e) => patchLine(i, { name: e.target.value, catalogItemId: null })}
                placeholder="Item"
                size={1}
              />
              <input
                aria-label="Quantity"
                inputMode="decimal"
                value={String(line.qty)}
                disabled={disabled}
                onChange={(e) => patchLine(i, { qty: Number(e.target.value) || 0 })}
                size={1}
              />
              <select
                aria-label="Unit"
                value={line.unit}
                disabled={disabled}
                onChange={(e) => patchLine(i, { unit: e.target.value as DispatchGoodsUnit })}
              >
                {DISPATCH_GOODS_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <input
                aria-label="m³ each"
                inputMode="decimal"
                value={line.volumeM3Each == null ? "" : String(line.volumeM3Each)}
                disabled={disabled}
                placeholder="m³"
                onChange={(e) =>
                  patchLine(i, {
                    volumeM3Each: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                size={1}
              />
              <input
                aria-label="kg each"
                inputMode="decimal"
                value={line.weightKgEach == null ? "" : String(line.weightKgEach)}
                disabled={disabled}
                placeholder="kg"
                onChange={(e) =>
                  patchLine(i, {
                    weightKgEach: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                size={1}
              />
              {scanSerial ? (
                <>
                  <input
                    aria-label="Serial"
                    value={line.serial || ""}
                    disabled={disabled}
                    placeholder="Serial"
                    onChange={(e) => patchLine(i, { serial: e.target.value })}
                    size={1}
                  />
                  <input
                    aria-label="Lot"
                    value={line.lot || ""}
                    disabled={disabled}
                    placeholder="Lot"
                    onChange={(e) => patchLine(i, { lot: e.target.value })}
                    size={1}
                  />
                </>
              ) : null}
              {!disabled ? (
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  onClick={() => onChange(lines.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {lines.length ? (
        <p className="dispatch-goods-totals">
          Goods sum {totals.volumeM3 != null ? `${totals.volumeM3} m³` : "— m³"} ·{" "}
          {totals.weightKg != null ? `${totals.weightKg} kg` : "— kg"}
          {onToggleLock ? (
            <label className="dispatch-plan-check">
              <input
                type="checkbox"
                checked={Boolean(totalsLocked)}
                disabled={disabled}
                onChange={(e) => onToggleLock(e.target.checked)}
              />
              Override order totals
            </label>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
