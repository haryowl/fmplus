import { tenantHeaders } from "./tenant";
import type { DispatchGoodsItem, DispatchOrderLine } from "./dispatch";
import type { CatalogItem, ServiceLine } from "./maintenance";

export type ScanContext = "dispatch_cargo" | "maint_part" | "any";

export type CatalogScanResult = {
  match: "goods" | "maint_part" | "vehicle" | "location" | "none";
  reason?: string;
  code: string;
  raw: string;
  codeFormat?: string;
  item?: DispatchGoodsItem | CatalogItem | { id: string };
};

export type CatalogScanOpts = {
  serialMode?: boolean;
  serial?: string;
  lot?: string;
  codeFormat?: string;
  onlyKnownSerial?: boolean;
};

export type ScanApplyResult<T> = { lines: T; error?: string };

function normUnit(s: string | undefined): string {
  return String(s || "").trim().toLowerCase();
}

export function isCatalogIdentityScan(opts: {
  sku?: string;
  kind: "goods" | "maint_part";
  scannedCode: string;
  codeFormat?: string;
}): boolean {
  const raw = String(opts.scannedCode || "").trim();
  if (!raw) return false;
  const format = String(opts.codeFormat || "").toLowerCase();
  if (format === "sku" || format === "ean" || format === "qr") return true;
  if (format === "nfc") return /^am1:v\d+:/i.test(raw);
  const sku = normUnit(opts.sku);
  if (sku && normUnit(raw) === sku) return true;
  const m = raw.match(/^am1:v\d+:(goods|part):(.+)$/i);
  if (!m) return false;
  const kind = m[1].toLowerCase() === "part" ? "maint_part" : "goods";
  return kind === opts.kind && (!sku || normUnit(m[2]) === sku);
}

export function catalogScanNeedsUnitId(opts: {
  sku?: string;
  kind: "goods" | "maint_part";
  scannedCode: string;
  codeFormat?: string;
  serialMode?: boolean;
}): boolean {
  return Boolean(opts.serialMode) && isCatalogIdentityScan(opts);
}

export function resolveScanSerial(opts: {
  sku?: string;
  kind: "goods" | "maint_part";
  scannedCode: string;
  codeFormat?: string;
  serial?: string;
}): string {
  const explicit = String(opts.serial || "").trim();
  if (explicit) return explicit;
  if (isCatalogIdentityScan(opts)) return "";
  return String(opts.scannedCode || "").trim();
}

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

export function applyGoodsScanResult(
  lines: DispatchOrderLine[],
  item: DispatchGoodsItem,
  scannedCode: string,
  opts?: CatalogScanOpts,
): ScanApplyResult<DispatchOrderLine[]> {
  const now = new Date().toISOString();
  if (!opts?.serialMode) {
    const idx = lines.findIndex((l) => l.catalogItemId === item.id);
    if (idx >= 0) {
      return {
        lines: lines.map((line, i) =>
          i === idx
            ? { ...line, qty: (Number(line.qty) || 0) + 1, scannedCode, scannedAt: now }
            : line,
        ),
      };
    }
    return {
      lines: [
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
      ],
    };
  }
  const serial = resolveScanSerial({
    sku: item.sku,
    kind: "goods",
    scannedCode,
    codeFormat: opts.codeFormat,
    serial: opts.serial,
  });
  if (!serial) return { lines, error: "Serial is required" };
  const known = lines.filter((l) => l.catalogItemId === item.id && String(l.serial || "").trim());
  if (opts.onlyKnownSerial && known.length && !known.some((l) => normUnit(l.serial) === normUnit(serial))) {
    return { lines, error: "This serial is not on the order" };
  }
  const idx = lines.findIndex((l) => l.catalogItemId === item.id && normUnit(l.serial) === normUnit(serial));
  if (idx >= 0) {
    return {
      lines: lines.map((line, i) =>
        i === idx
          ? {
              ...line,
              scannedCode,
              serial,
              lot: opts.lot != null && opts.lot !== "" ? opts.lot : line.lot,
              scannedAt: now,
            }
          : line,
      ),
    };
  }
  return {
    lines: [
      ...lines,
      {
        catalogItemId: item.id,
        name: item.name,
        qty: 1,
        unit: item.unit,
        volumeM3Each: item.volumeM3Each,
        weightKgEach: item.weightKgEach,
        scannedCode,
        serial,
        lot: opts.lot || "",
        scannedAt: now,
      },
    ],
  };
}

export function applyGoodsScan(
  lines: DispatchOrderLine[],
  item: DispatchGoodsItem,
  scannedCode: string,
  opts?: CatalogScanOpts,
): DispatchOrderLine[] {
  return applyGoodsScanResult(lines, item, scannedCode, opts).lines;
}

export function applyMaintPartScanResult(
  lines: ServiceLine[],
  item: CatalogItem,
  scannedCode: string,
  opts?: CatalogScanOpts,
): ScanApplyResult<ServiceLine[]> {
  const now = new Date().toISOString();
  const nextLine = (serial?: string, lot?: string): ServiceLine => ({
    kind: "part",
    catalogItemId: item.id,
    description: item.name,
    qty: 1,
    unitPrice: item.unitPrice,
    unitCost: item.unitCost,
    vendor: "",
    scannedCode,
    serial: serial || "",
    lot: lot || "",
    scannedAt: now,
  });
  const replaceEmpty = (next: ServiceLine[]) => {
    const empty = lines.length === 1 && !lines[0]?.catalogItemId && !String(lines[0]?.description || "").trim();
    return empty ? next : [...lines, ...next];
  };

  if (!opts?.serialMode) {
    const idx = lines.findIndex((l) => l.catalogItemId === item.id);
    if (idx >= 0) {
      return {
        lines: lines.map((line, i) =>
          i === idx
            ? { ...line, qty: (Number(line.qty) || 0) + 1, scannedCode, scannedAt: now }
            : line,
        ),
      };
    }
    return { lines: replaceEmpty([nextLine()]) };
  }

  const serial = resolveScanSerial({
    sku: item.sku,
    kind: "maint_part",
    scannedCode,
    codeFormat: opts.codeFormat,
    serial: opts.serial,
  });
  if (!serial) return { lines, error: "Serial is required" };
  const known = lines.filter((l) => l.catalogItemId === item.id && String(l.serial || "").trim());
  if (opts.onlyKnownSerial && known.length && !known.some((l) => normUnit(l.serial) === normUnit(serial))) {
    return { lines, error: "This serial is not on the job" };
  }
  const idx = lines.findIndex((l) => l.catalogItemId === item.id && normUnit(l.serial) === normUnit(serial));
  if (idx >= 0) {
    return {
      lines: lines.map((line, i) =>
        i === idx
          ? {
              ...line,
              scannedCode,
              serial,
              lot: opts.lot != null && opts.lot !== "" ? opts.lot : line.lot,
              scannedAt: now,
            }
          : line,
      ),
    };
  }
  return { lines: replaceEmpty([nextLine(serial, opts.lot)]) };
}

export function applyMaintPartScan(
  lines: ServiceLine[],
  item: CatalogItem,
  scannedCode: string,
  opts?: CatalogScanOpts,
): ServiceLine[] {
  return applyMaintPartScanResult(lines, item, scannedCode, opts).lines;
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
