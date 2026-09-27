import { useEffect, useState } from "react";
import {
  addCatalogCodeRow,
  deleteCatalogCodeRow,
  fetchCatalogCodes,
  scanPayloadFor,
  type CatalogCodeRow,
} from "../lib/catalogCodes";

type Props = {
  kind: "goods" | "maint_part";
  itemId: string;
  sku?: string;
  name: string;
  disabled?: boolean;
};

function printLabel(name: string, sku: string, payload: string) {
  const win = window.open("", "_blank", "width=420,height=520");
  if (!win) return;
  const safe = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  win.document.write(`<!doctype html><html><head><title>${safe(name)}</title>
<style>
  body { font-family: sans-serif; padding: 24px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .sku { font-size: 14px; color: #444; }
  .payload { font-family: ui-monospace, monospace; font-size: 12px; margin-top: 16px; word-break: break-all; }
  img { width: 220px; height: 220px; margin: 16px 0; }
</style></head><body>
  <h1>${safe(name)}</h1>
  <p class="sku">${safe(sku || "—")}</p>
  ${
    payload
      ? `<img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}" />`
      : ""
  }
  <p class="payload">${safe(payload || "Add a SKU to print a QR")}</p>
</body></html>`);
  win.document.close();
  win.focus();
}

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
          onClick={() => printLabel(name, sku || "", payload)}
        >
          Print QR
        </button>
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
