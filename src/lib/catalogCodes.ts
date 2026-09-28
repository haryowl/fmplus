import { tenantHeaders } from "./tenant";

export type CatalogTargetKind = "goods" | "maint_part" | "vehicle" | "location";

export type CatalogCodeRow = {
  id: string;
  targetKind: string;
  targetId: string;
  code: string;
  codeFormat: string;
  label: string;
  enabled: boolean;
};

export function scanPayloadFor(kind: CatalogTargetKind, sku: string): string {
  const token = kind === "maint_part" ? "part" : kind;
  const code = String(sku || "").trim();
  return code ? `am1:v1:${token}:${code}` : "";
}

function codesBasePath(kind: CatalogTargetKind, itemId: string): string {
  if (kind === "goods") return `/api/dispatch/goods/${itemId}/codes`;
  if (kind === "maint_part") return `/api/maintenance/catalog/items/${itemId}/codes`;
  if (kind === "vehicle") return `/api/dispatch/vehicles/${itemId}/codes`;
  return `/api/dispatch/locations/${itemId}/codes`;
}

function escapePrintHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Opens a print sheet with QR (versioned payload) and Code 128 (SKU). */
export function printCatalogLabel(kind: CatalogTargetKind, name: string, sku: string): void {
  const payload = scanPayloadFor(kind, sku);
  const label = String(name || "").trim() || "Catalog item";
  const code = String(sku || "").trim();
  if (!payload || !code) return;
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) return;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
  const barSrc = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(code)}&scale=2&height=12&includetext`;
  win.document.write(`<!doctype html><html><head><title>${escapePrintHtml(label)}</title>
<style>
  body { font-family: sans-serif; padding: 24px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .sku { font-size: 14px; color: #444; margin: 0 0 16px; }
  .payload { font-family: ui-monospace, monospace; font-size: 11px; margin-top: 16px; word-break: break-all; color: #555; }
  img { display: block; margin: 12px auto; }
  .qr { width: 220px; height: 220px; }
  .bar { max-width: 280px; height: auto; }
  @media print { button { display: none; } }
</style></head><body>
  <h1>${escapePrintHtml(label)}</h1>
  <p class="sku">${escapePrintHtml(code)}</p>
  <img class="qr" alt="QR" src="${qrSrc}" />
  <img class="bar" alt="Barcode" src="${barSrc}" />
  <p class="payload">${escapePrintHtml(payload)}</p>
  <button type="button" onclick="window.print()">Print</button>
</body></html>`);
  win.document.close();
  win.focus();
}

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export async function fetchCatalogCodes(
  kind: CatalogTargetKind,
  itemId: string,
): Promise<CatalogCodeRow[]> {
  const path = codesBasePath(kind, itemId);
  const res = await fetch(path, {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await readJson<{ codes?: CatalogCodeRow[] }>(res);
  if (!res.ok) throw new Error(data.error || `Codes ${res.status}`);
  return data.codes || [];
}

export async function addCatalogCodeRow(
  kind: CatalogTargetKind,
  itemId: string,
  body: { code: string; codeFormat?: string; label?: string },
): Promise<CatalogCodeRow> {
  const path = codesBasePath(kind, itemId);
  const res = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...tenantHeaders() },
    body: JSON.stringify(body),
  });
  const data = await readJson<{ code?: CatalogCodeRow }>(res);
  if (!res.ok) throw new Error(data.error || `Add code ${res.status}`);
  if (!data.code) throw new Error("Add code failed");
  return data.code;
}

export async function deleteCatalogCodeRow(
  kind: CatalogTargetKind,
  itemId: string,
  codeId: string,
): Promise<void> {
  const path = `${codesBasePath(kind, itemId)}/${codeId}`;
  const res = await fetch(path, {
    method: "DELETE",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || `Delete code ${res.status}`);
}
