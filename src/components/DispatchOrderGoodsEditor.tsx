import { useMemo, useState } from "react";
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
}: Props) {
  const [query, setQuery] = useState("");
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
        </div>
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

      {lines.length === 0 ? (
        <p className="dispatch-search-hint">Optional. Add catalog items or free text.</p>
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
