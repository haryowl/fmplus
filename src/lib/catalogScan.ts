import { tenantHeaders } from "./tenant";
import {
  lineAmountIdr,
  pricedOrderLineFromCatalog,
  type DispatchGoodsItem,
  type DispatchOrderLine,
} from "./dispatch";
import type { CatalogItem, ServiceLine } from "./maintenance";

export type ScanContext = "dispatch_cargo" | "maint_part" | "vehicle" | "location" | "any";

export type VehicleScanItem = {
  id: string;
  armadaUserId: number;
  /** GPS tracker device UUID when the scan target is device-native. */
  trackerDeviceId?: string | null;
  label?: string;
  plateParity?: string;
};

export type VehicleScanRef = {
  armadaUserId?: number | null;
  trackerDeviceId?: string | null;
};

export type LocationScanItem = {
  id: string;
  name: string;
  lat?: number;
  lon?: number;
};

export type CatalogScanResult = {
  match: "goods" | "maint_part" | "vehicle" | "location" | "none";
  reason?: string;
  code: string;
  raw: string;
  codeFormat?: string;
  item?: DispatchGoodsItem | CatalogItem | VehicleScanItem | LocationScanItem | { id: string };
};

export type CatalogScanOpts = {
  serialMode?: boolean;
  serial?: string;
  lot?: string;
  codeFormat?: string;
  onlyKnownSerial?: boolean;
  confirmMode?: boolean;
  /** Do not bump qty on lines that already have a server id (Field assigned cargo). */
  lockAssigned?: boolean;
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

export function catalogExpectedLines(lines: DispatchOrderLine[]): DispatchOrderLine[] {
  return lines.filter((l) => Boolean(l.catalogItemId));
}

export function catalogLineConfirmed(line: DispatchOrderLine): boolean {
  return Boolean(line.scannedAt);
}

export function catalogConfirmPending(lines: DispatchOrderLine[]): DispatchOrderLine[] {
  return catalogExpectedLines(lines).filter((l) => !catalogLineConfirmed(l));
}

export function stopRequireScanBlocks(lines: DispatchOrderLine[]): boolean {
  return catalogConfirmPending(lines).length > 0;
}

export function catalogExpectedPartLines(lines: ServiceLine[]): ServiceLine[] {
  return lines.filter((l) => l.kind !== "service" && l.kind !== "labor" && l.kind !== "other" && Boolean(l.catalogItemId));
}

export function jobRequireScanReason(opts: {
  lines?: ServiceLine[];
  cargoLines?: DispatchOrderLine[];
  requireVehicle?: boolean;
  vehicleConfirmed?: boolean;
}): string | null {
  const partPending = catalogExpectedPartLines(opts.lines || []).filter((l) => !l.scannedAt);
  if (partPending.length) {
    return `Scan every catalog part before completing this job (${partPending.length} pending)`;
  }
  const cargoPending = catalogConfirmPending(opts.cargoLines || []);
  if (cargoPending.length) {
    return `Scan every expected item before completing this job (${cargoPending.length} pending)`;
  }
  if (opts.requireVehicle && !opts.vehicleConfirmed) {
    return "Scan the asset before completing this job";
  }
  return null;
}

function isTrackerDeviceId(id: unknown): boolean {
  return /^[0-9a-f-]{36}$/i.test(String(id || "").trim());
}

/** Vehicle tag on + job has a truck → Field must confirm that plate before work. */
export function vehicleScanBlocks(opts: {
  vehicleOpen?: boolean;
  armadaUserId?: number | null;
  trackerDeviceId?: string | null;
  vehicleConfirmed?: boolean;
  action?: "start" | "stop" | "complete";
}): string | null {
  if (opts.vehicleOpen !== true) return null;
  const uid = Number(opts.armadaUserId);
  const hasArmada = Number.isFinite(uid) && uid > 0;
  const hasDevice = isTrackerDeviceId(opts.trackerDeviceId);
  if (!hasArmada && !hasDevice) return null;
  if (opts.vehicleConfirmed) return null;
  if (opts.action === "start") return "Scan the asset before starting this route";
  if (opts.action === "stop") return "Scan the asset before opening this order";
  return "Scan the asset before completing this job";
}

export function vehicleIdFromScan(
  item: { id?: string; armadaUserId?: number; trackerDeviceId?: string | null } | undefined,
): number | null {
  if (!item) return null;
  const n = Number(item.armadaUserId);
  if (Number.isFinite(n) && n > 0) return n;
  // Device-only scans use UUID id — do not coerce to a fake Armada user id.
  if (isTrackerDeviceId(item.trackerDeviceId || item.id)) return null;
  const fallback = Number(item.id);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

export function vehicleDeviceIdFromScan(
  item: { id?: string; trackerDeviceId?: string | null } | undefined,
): string | null {
  if (!item) return null;
  const did = String(item.trackerDeviceId || "").trim();
  if (isTrackerDeviceId(did)) return did;
  const id = String(item.id || "").trim();
  return isTrackerDeviceId(id) ? id : null;
}

export function vehicleRefFromScan(
  item: { id?: string; armadaUserId?: number; trackerDeviceId?: string | null } | undefined,
): VehicleScanRef | null {
  if (!item) return null;
  const armadaUserId = vehicleIdFromScan(item);
  const trackerDeviceId = vehicleDeviceIdFromScan(item);
  if (!armadaUserId && !trackerDeviceId) return null;
  return { armadaUserId, trackerDeviceId };
}

function jobMatchesVehicleRef(
  job: { armadaUserId?: number | null; trackerDeviceId?: string | null },
  ref: VehicleScanRef,
): boolean {
  const did = String(ref.trackerDeviceId || "").trim();
  if (isTrackerDeviceId(did) && String(job.trackerDeviceId || "").trim() === did) return true;
  const uid = Number(ref.armadaUserId);
  if (Number.isFinite(uid) && uid > 0 && Number(job.armadaUserId) === uid) return true;
  return false;
}

function jobHasVehicle(
  job: { armadaUserId?: number | null; trackerDeviceId?: string | null } | undefined,
): boolean {
  if (!job) return false;
  const uid = Number(job.armadaUserId);
  return (Number.isFinite(uid) && uid > 0) || isTrackerDeviceId(job.trackerDeviceId);
}

export function locationNameFromScan(item: { id?: string; name?: string } | undefined): string {
  return String(item?.name || item?.id || "").trim();
}

function isClosedJobStatus(status?: string): boolean {
  return status === "done" || status === "cancelled" || status === "skipped" || status === "approved";
}

export function resolveVehicleJobOpen<
  T extends {
    id: string;
    armadaUserId?: number | null;
    trackerDeviceId?: string | null;
    status?: string;
  },
>(
  jobs: T[],
  vehicleUserId: number | VehicleScanRef,
  selectedId?: string | null,
): { jobId: string; notice: string } | { error: string } {
  const ref: VehicleScanRef =
    typeof vehicleUserId === "number"
      ? { armadaUserId: vehicleUserId }
      : vehicleUserId || {};
  const hasRef =
    (Number.isFinite(Number(ref.armadaUserId)) && Number(ref.armadaUserId) > 0) ||
    isTrackerDeviceId(ref.trackerDeviceId);
  if (!hasRef) return { error: "No open job for this asset" };

  const selected = selectedId ? jobs.find((j) => j.id === selectedId) : undefined;
  if (selected && jobMatchesVehicleRef(selected, ref)) {
    return { jobId: selected.id, notice: "Asset confirmed" };
  }
  const match = jobs.find((j) => jobMatchesVehicleRef(j, ref) && !isClosedJobStatus(j.status));
  if (match) {
    return {
      jobId: match.id,
      notice: selected && selected.id !== match.id ? "Opened job for this asset" : "Asset confirmed",
    };
  }
  if (selected && jobHasVehicle(selected) && !jobMatchesVehicleRef(selected, ref)) {
    return { error: "Wrong asset" };
  }
  return { error: "No open job for this asset" };
}

export function formatOnHand(
  item?: {
    onHand?: number | null;
    reservedQty?: number | null;
    unit?: string | null;
    unitsPerPack?: number | null;
  } | null,
): string {
  if (!item || item.onHand == null || !Number.isFinite(Number(item.onHand))) return "";
  const onHand = Number(item.onHand);
  const reserved = Number(item.reservedQty) || 0;
  const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));
  const unit = String(item.unit || "").trim();
  const pack = item.unitsPerPack == null ? null : Number(item.unitsPerPack);
  const packOk = pack != null && Number.isFinite(pack) && pack > 0;
  const unitSuffix = unit ? ` ${unit}` : "";
  const pcsNote = (n: number) => (packOk ? ` (${qty(n * (pack as number))} pcs)` : "");
  if (reserved > 0) {
    const avail = onHand - reserved;
    return `${qty(avail)}${unitSuffix}${pcsNote(avail)} available · ${qty(onHand)}${unitSuffix} on hand`;
  }
  return `${qty(onHand)}${unitSuffix}${pcsNote(onHand)} on hand`;
}

export function locationScanNotice(opts: { name: string; zone?: string | null }): string {
  const name = String(opts.name || "").trim();
  const zone = String(opts.zone || "").trim();
  if (zone && zone.toLowerCase() === name.toLowerCase()) return `Location confirmed · ${name}`;
  if (zone) return `Location: ${name} (stop zone is ${zone})`;
  return name ? `Location: ${name}` : "Location confirmed";
}

export function applyGoodsScanResult(
  lines: DispatchOrderLine[],
  item: DispatchGoodsItem,
  scannedCode: string,
  opts?: CatalogScanOpts,
): ScanApplyResult<DispatchOrderLine[]> {
  const now = new Date().toISOString();
  if (opts?.confirmMode) {
    if (opts.serialMode) {
      const serial = resolveScanSerial({
        sku: item.sku,
        kind: "goods",
        scannedCode,
        codeFormat: opts.codeFormat,
        serial: opts.serial,
      });
      if (!serial) return { lines, error: "Serial is required" };
      const idx = lines.findIndex(
        (l) => l.catalogItemId === item.id && normUnit(l.serial) === normUnit(serial),
      );
      if (idx < 0) return { lines, error: "Not expected on this stop" };
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
    const pendingIdx = lines.findIndex((l) => l.catalogItemId === item.id && !l.scannedAt);
    const idx = pendingIdx >= 0 ? pendingIdx : lines.findIndex((l) => l.catalogItemId === item.id);
    if (idx < 0) return { lines, error: "Not expected on this stop" };
    return {
      lines: lines.map((line, i) =>
        i === idx ? { ...line, scannedCode, scannedAt: now } : line,
      ),
    };
  }
  if (!opts?.serialMode) {
    const idx = lines.findIndex((l) => l.catalogItemId === item.id);
    if (idx >= 0) {
      if (opts?.lockAssigned && lines[idx]?.id) {
        return {
          lines: lines.map((line, i) =>
            i === idx ? { ...line, scannedCode, scannedAt: now } : line,
          ),
        };
      }
      return {
        lines: lines.map((line, i) => {
          if (i !== idx) return line;
          const qty = (Number(line.qty) || 0) + 1;
          const unitPrice = line.unitPrice ?? pricedOrderLineFromCatalog(item, qty).unitPrice;
          return {
            ...line,
            qty,
            unitPrice,
            costPrice: line.costPrice ?? pricedOrderLineFromCatalog(item, qty).costPrice,
            lineAmount: lineAmountIdr(qty, unitPrice),
            scannedCode,
            scannedAt: now,
          };
        }),
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
          ...pricedOrderLineFromCatalog(item, 1),
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
        ...pricedOrderLineFromCatalog(item, 1),
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
