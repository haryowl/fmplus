/** Field scan switchboard. Mirrors server/scan-capabilities.mjs. */

export const SCAN_ROLES = ["operator", "driver", "dispatcher", "manager"] as const;
export type ScanRole = (typeof SCAN_ROLES)[number];

export const SCAN_ACTION_KEYS = [
  "cargoAdd",
  "partAdd",
  "cargoConfirm",
  "cargoSerial",
  "stopRequireScan",
  "partSerial",
  "jobRequireScan",
  "vehicleOpen",
  "locationSet",
] as const;
export type ScanActionKey = (typeof SCAN_ACTION_KEYS)[number];

/** Actions Field already enforces. Other keys persist for later phases. */
export const SCAN_BUILT_ACTIONS: readonly ScanActionKey[] = [
  "cargoAdd",
  "partAdd",
  "cargoSerial",
  "partSerial",
];

export const SCAN_INPUT_KEYS = ["camera", "typed", "nfc"] as const;
export type ScanInputKey = (typeof SCAN_INPUT_KEYS)[number];
export const SCAN_BUILT_INPUTS: readonly ScanInputKey[] = ["camera", "typed", "nfc"];

export type ScanRoleActions = Record<ScanActionKey, boolean>;

export type ScanEntitlements = {
  inputs: Record<ScanInputKey, boolean>;
  roles: Record<ScanRole, ScanRoleActions>;
};

export type FieldScanCapabilities = ScanRoleActions & Record<ScanInputKey, boolean>;

export const SCAN_ROLE_LABELS: Record<ScanRole, string> = {
  operator: "Operator",
  driver: "Driver",
  dispatcher: "Dispatcher",
  manager: "Manager",
};

export const SCAN_ACTION_LABELS: Record<ScanActionKey, string> = {
  cargoAdd: "Cargo add",
  partAdd: "Part add",
  cargoConfirm: "Cargo confirm",
  cargoSerial: "Cargo serial",
  stopRequireScan: "Require stop",
  partSerial: "Part serial",
  jobRequireScan: "Require job",
  vehicleOpen: "Vehicle tag",
  locationSet: "Location tag",
};

export const SCAN_INPUT_LABELS: Record<ScanInputKey, string> = {
  camera: "Camera / barcode",
  typed: "Type the code",
  nfc: "NFC read",
};

export function defaultScanRoleActions(): ScanRoleActions {
  return {
    cargoAdd: true,
    partAdd: true,
    cargoConfirm: false,
    cargoSerial: false,
    stopRequireScan: false,
    partSerial: false,
    jobRequireScan: false,
    vehicleOpen: false,
    locationSet: false,
  };
}

export function defaultScanEntitlements(): ScanEntitlements {
  return {
    inputs: { camera: true, typed: true, nfc: false },
    roles: {
      operator: defaultScanRoleActions(),
      driver: defaultScanRoleActions(),
      dispatcher: defaultScanRoleActions(),
      manager: defaultScanRoleActions(),
    },
  };
}

function mergeBoolMap<T extends string>(
  base: Record<T, boolean>,
  incoming: unknown,
): Record<T, boolean> {
  const next = { ...base };
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return next;
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    if (key in next && typeof value === "boolean") {
      (next as Record<string, boolean>)[key] = value;
    }
  }
  return next;
}

export function mergeScanEntitlements(raw: unknown): ScanEntitlements {
  const base = defaultScanEntitlements();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const src = raw as Record<string, unknown>;
  base.inputs = mergeBoolMap(base.inputs, src.inputs);
  if (src.roles && typeof src.roles === "object" && !Array.isArray(src.roles)) {
    const roles = src.roles as Record<string, unknown>;
    for (const role of SCAN_ROLES) {
      base.roles[role] = mergeBoolMap(base.roles[role], roles[role]);
    }
  }
  return base;
}

export function resolveFieldScan(scan: ScanEntitlements, role: string): FieldScanCapabilities {
  const key: ScanRole = SCAN_ROLES.includes(role as ScanRole) ? (role as ScanRole) : "operator";
  return {
    ...scan.roles[key],
    camera: scan.inputs.camera === true,
    typed: scan.inputs.typed === true,
    nfc: scan.inputs.nfc === true,
  };
}

export function fieldScanHasInput(caps: Pick<FieldScanCapabilities, ScanInputKey>): boolean {
  return caps.camera === true || caps.typed === true || caps.nfc === true;
}

export function fieldScanAllowsContext(
  caps: Pick<FieldScanCapabilities, "cargoAdd" | "partAdd">,
  context: string,
): boolean {
  if (context === "dispatch_cargo") return caps.cargoAdd === true;
  if (context === "maint_part") return caps.partAdd === true;
  return caps.cargoAdd === true || caps.partAdd === true;
}

export function fieldScanCanCargo(scan?: FieldScanCapabilities | null): boolean {
  if (!scan) return true;
  return scan.cargoAdd === true && fieldScanHasInput(scan);
}

export function fieldScanCanPart(scan?: FieldScanCapabilities | null): boolean {
  if (!scan) return true;
  return scan.partAdd === true && fieldScanHasInput(scan);
}
