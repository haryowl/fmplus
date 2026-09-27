import { tenantHeaders } from "./tenant";
import type { DispatchGoodsItem, DispatchOrderLine } from "./dispatch";
import type { CatalogItem, ServiceLine } from "./maintenance";

export type ScanContext = "dispatch_cargo" | "maint_part" | "any";

export type CatalogScanResult = {
  match: "goods" | "maint_part" | "vehicle" | "location" | "none";
  reason?: string;
  code: string;
  raw: string;
  item?: DispatchGoodsItem | CatalogItem | { id: string };
};

export async function lookupCatalogScan(
  code: string,
  context: ScanContext,
  source: "field" | "desk",
): Promise<CatalogScanResult> {
  const path =
    source === "field"
      ? "/api/field/scan"
      : context === "maint_part"
        ? "/api/maintenance/scan"
        : "/api/dispatch/scan";
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(source === "desk" ? tenantHeaders() : {}),
    },
    body: JSON.stringify({ code, context }),
  });
  const data = (await res.json().catch(() => ({}))) as CatalogScanResult & { error?: string };
  if (!res.ok) throw new Error(data.error || `Scan ${res.status}`);
  return data;
}

export function applyGoodsScan(
  lines: DispatchOrderLine[],
  item: DispatchGoodsItem,
  scannedCode: string,
): DispatchOrderLine[] {
  const idx = lines.findIndex((l) => l.catalogItemId === item.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    return lines.map((line, i) =>
      i === idx
        ? { ...line, qty: (Number(line.qty) || 0) + 1, scannedCode, scannedAt: now }
        : line,
    );
  }
  return [
    ...lines,
    {
      catalogItemId: item.id,
      name: item.name,
      qty: 1,
      unit: item.unit,
      volumeM3Each: item.volumeM3Each,
      weightKgEach: item.weightKgEach,
      scannedCode,
      scannedAt: now,
    },
  ];
}

export function applyMaintPartScan(
  lines: ServiceLine[],
  item: CatalogItem,
  scannedCode: string,
): ServiceLine[] {
  const idx = lines.findIndex((l) => l.catalogItemId === item.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    return lines.map((line, i) =>
      i === idx
        ? { ...line, qty: (Number(line.qty) || 0) + 1, scannedCode, scannedAt: now }
        : line,
    );
  }
  const next: ServiceLine = {
    kind: "part",
    catalogItemId: item.id,
    description: item.name,
    qty: 1,
    unitPrice: item.unitPrice,
    unitCost: item.unitCost,
    vendor: "",
    scannedCode,
    scannedAt: now,
  };
  const empty = lines.length === 1 && !lines[0]?.catalogItemId && !String(lines[0]?.description || "").trim();
  return empty ? [next] : [...lines, next];
}

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export function barcodeDetectorAvailable(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export async function detectBarcodeFromVideo(video: HTMLVideoElement): Promise<string | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  const detector = new Ctor({
    formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"],
  });
  const hits = await detector.detect(video);
  const value = hits.map((h) => String(h.rawValue || "").trim()).find(Boolean);
  return value || null;
}
