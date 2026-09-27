import { tenantHeaders } from "./tenant";

export type CatalogCodeRow = {
  id: string;
  targetKind: string;
  targetId: string;
  code: string;
  codeFormat: string;
  label: string;
  enabled: boolean;
};

export function scanPayloadFor(kind: "goods" | "maint_part", sku: string): string {
  const token = kind === "maint_part" ? "part" : "goods";
  const code = String(sku || "").trim();
  return code ? `am1:v1:${token}:${code}` : "";
}

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export async function fetchCatalogCodes(
  kind: "goods" | "maint_part",
  itemId: string,
): Promise<CatalogCodeRow[]> {
  const path =
    kind === "goods"
      ? `/api/dispatch/goods/${itemId}/codes`
      : `/api/maintenance/catalog/items/${itemId}/codes`;
  const res = await fetch(path, {
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await readJson<{ codes?: CatalogCodeRow[] }>(res);
  if (!res.ok) throw new Error(data.error || `Codes ${res.status}`);
  return data.codes || [];
}

export async function addCatalogCodeRow(
  kind: "goods" | "maint_part",
  itemId: string,
  body: { code: string; codeFormat?: string; label?: string },
): Promise<CatalogCodeRow> {
  const path =
    kind === "goods"
      ? `/api/dispatch/goods/${itemId}/codes`
      : `/api/maintenance/catalog/items/${itemId}/codes`;
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
  kind: "goods" | "maint_part",
  itemId: string,
  codeId: string,
): Promise<void> {
  const path =
    kind === "goods"
      ? `/api/dispatch/goods/${itemId}/codes/${codeId}`
      : `/api/maintenance/catalog/items/${itemId}/codes/${codeId}`;
  const res = await fetch(path, {
    method: "DELETE",
    headers: { accept: "application/json", ...tenantHeaders() },
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || `Delete code ${res.status}`);
}
