import type { CatalogGroup, CatalogItem, LineKind, ServiceLine } from "../lib/maintenance";
import { LINE_KIND_LABELS, normalizeLineKindUi } from "../lib/maintenance";

type Props = {
  line: ServiceLine;
  catalog: CatalogGroup[];
  disabled?: boolean;
  compact?: boolean;
  onChange: (patch: Partial<ServiceLine>) => void;
  onRemove: () => void;
};

const KIND_OPTIONS = Object.keys(LINE_KIND_LABELS) as Array<"part" | "service" | "other">;

function itemsForKind(catalog: CatalogGroup[], kind: LineKind): CatalogItem[] {
  const key = normalizeLineKindUi(kind);
  const group = catalog.find((g) => g.key === key);
  return (group?.items || []).filter((it) => it.enabled !== false);
}

export function CatalogLineEditor({ line, catalog, disabled, compact, onChange, onRemove }: Props) {
  const kind = normalizeLineKindUi(line.kind);
  const items = itemsForKind(catalog, kind);
  const freeText = kind === "other" || !line.catalogItemId;
  const selectValue = line.catalogItemId || (freeText && kind !== "other" ? "__custom__" : "");

  function setKind(next: "part" | "service" | "other") {
    onChange({
      kind: next,
      catalogItemId: null,
      description: next === kind ? line.description : "",
      unitPrice: next === kind ? line.unitPrice : null,
      unitCost: next === kind ? line.unitCost : null,
    });
  }

  function pickItem(itemId: string) {
    if (itemId === "__custom__") {
      onChange({ catalogItemId: null });
      return;
    }
    if (!itemId) {
      onChange({ catalogItemId: null, description: "" });
      return;
    }
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    onChange({
      catalogItemId: item.id,
      description: item.name,
      unitPrice: item.unitPrice,
      unitCost: item.unitCost,
      kind,
    });
  }

  if (compact) {
    return (
      <article className="field-line-card">
        <div className="field-line-top">
          <select
            value={kind}
            disabled={disabled}
            onChange={(e) => setKind(e.target.value as "part" | "service" | "other")}
            aria-label="Line kind"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {LINE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost btn-compact" disabled={disabled} onClick={onRemove}>
            Remove
          </button>
        </div>
        {kind !== "other" ? (
          <select
            value={selectValue}
            disabled={disabled}
            onChange={(e) => pickItem(e.target.value)}
            aria-label="Catalog item"
          >
            <option value="">Select item…</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
                {it.unitPrice != null ? ` · ${it.unitPrice}` : ""}
              </option>
            ))}
            <option value="__custom__">Not listed (free text)</option>
          </select>
        ) : null}
        {(kind === "other" || !line.catalogItemId) && (
          <input
            placeholder={kind === "other" ? "Describe other work / part" : "Description"}
            value={line.description}
            disabled={disabled}
            onChange={(e) => onChange({ description: e.target.value, catalogItemId: null })}
          />
        )}
        <div className="field-line-grid">
          <label>
            Qty
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={line.qty}
              disabled={disabled}
              onChange={(e) => onChange({ qty: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            Unit price
            <input
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="0"
              value={line.unitPrice ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({ unitPrice: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>
          <label>
            Unit cost
            <input
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="0"
              value={line.unitCost ?? ""}
              disabled={disabled}
              onChange={(e) =>
                onChange({ unitCost: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>
          <label>
            Vendor
            <input
              value={line.vendor}
              disabled={disabled}
              onChange={(e) => onChange({ vendor: e.target.value })}
              placeholder="Optional"
            />
          </label>
        </div>
      </article>
    );
  }

  return (
    <div className="maintenance-line-row">
      <select
        value={kind}
        disabled={disabled}
        onChange={(e) => setKind(e.target.value as "part" | "service" | "other")}
        aria-label="Kind"
      >
        {KIND_OPTIONS.map((k) => (
          <option key={k} value={k}>
            {LINE_KIND_LABELS[k]}
          </option>
        ))}
      </select>
      {kind !== "other" ? (
        <select
          value={selectValue}
          disabled={disabled}
          onChange={(e) => pickItem(e.target.value)}
          aria-label="Catalog item"
        >
          <option value="">Select item…</option>
          {items.map((it) => (
            <option key={it.id} value={it.id}>
              {it.name}
            </option>
          ))}
          <option value="__custom__">Not listed…</option>
        </select>
      ) : (
        <span className="muted maintenance-line-spacer">Free text</span>
      )}
      <input
        placeholder="Description"
        value={line.description}
        disabled={disabled || (Boolean(line.catalogItemId) && kind !== "other")}
        onChange={(e) => onChange({ description: e.target.value, catalogItemId: null })}
      />
      <input
        type="number"
        step="any"
        min={0}
        placeholder="Qty"
        value={line.qty}
        disabled={disabled}
        onChange={(e) => onChange({ qty: Number(e.target.value) || 0 })}
      />
      <input
        type="number"
        step="any"
        placeholder="Unit price"
        value={line.unitPrice ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ unitPrice: e.target.value === "" ? null : Number(e.target.value) })}
      />
      <input
        type="number"
        step="any"
        placeholder="Unit cost"
        value={line.unitCost ?? ""}
        disabled={disabled}
        onChange={(e) => onChange({ unitCost: e.target.value === "" ? null : Number(e.target.value) })}
      />
      <input
        placeholder="Vendor"
        value={line.vendor}
        disabled={disabled}
        onChange={(e) => onChange({ vendor: e.target.value })}
      />
      <button type="button" className="btn-icon" title="Remove line" disabled={disabled} onClick={onRemove}>
        ×
      </button>
    </div>
  );
}
