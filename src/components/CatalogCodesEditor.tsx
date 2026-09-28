import { useEffect, useState } from "react";
import {
  addCatalogCodeRow,
  deleteCatalogCodeRow,
  fetchCatalogCodes,
  printCatalogLabel,
  scanPayloadFor,
  type CatalogCodeRow,
} from "../lib/catalogCodes";
import { CatalogNfcWriteButton } from "./CatalogNfcWriteButton";

type Props = {
  kind: "goods" | "maint_part";
  itemId: string;
  sku?: string;
  name: string;
  disabled?: boolean;
};

export function CatalogCodesEditor({ kind, itemId, sku, name, disabled }: Props) {
  const [codes, setCodes] = useState<CatalogCodeRow[]>([]);
  const [extra, setExtra] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const payload = scanPayloadFor(kind, sku || "");

  async function reload() {
    setCodes(await fetchCatalogCodes(kind, itemId));
  }

  useEffect(() => {
    void reload().catch((err: Error) => setError(err.message));
  }, [itemId, kind]);

  async function addExtra() {
    const code = extra.trim();
    if (!code) return;
    setBusy(true);
    setError("");
    try {
      await addCatalogCodeRow(kind, itemId, { code, codeFormat: "ean", label: "Barcode" });
      setExtra("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="catalog-codes-editor">
      {error ? <p className="muted">{error}</p> : null}
      <div className="catalog-codes-actions">
        <button
          type="button"
          className="btn-ghost btn-compact"
          disabled={disabled || !payload}
          onClick={() => printCatalogLabel(kind, name, sku || "")}
        >
          Print QR / barcode
        </button>
        <CatalogNfcWriteButton kind={kind} name={name} sku={sku || ""} disabled={disabled} />
      </div>
      {codes.length ? (
        <ul className="catalog-codes-list">
          {codes.map((c) => (
            <li key={c.id}>
              <span>
                {c.code}
                <em>
                  {c.codeFormat}
                  {c.label ? ` · ${c.label}` : ""}
                </em>
              </span>
              {c.codeFormat !== "sku" ? (
                <button
                  type="button"
                  className="btn-ghost btn-compact"
                  disabled={disabled || busy}
                  onClick={() => {
                    void deleteCatalogCodeRow(kind, itemId, c.id)
                      .then(reload)
                      .catch((err: Error) => setError(err.message));
                  }}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No scan codes yet. Save a SKU to create the primary code.</p>
      )}
      <form
        className="catalog-codes-add"
        onSubmit={(e) => {
          e.preventDefault();
          void addExtra();
        }}
      >
        <input
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Extra barcode / EAN / NFC UID"
          disabled={disabled || busy}
          size={1}
        />
        <button type="submit" className="btn-secondary" disabled={disabled || busy || !extra.trim()}>
          Add code
        </button>
      </form>
    </div>
  );
}
