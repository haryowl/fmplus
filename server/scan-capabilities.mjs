/**
 * Field scan switchboard (tenant entitlements.scan × field_users.role).
 * Mirrors src/lib/scanCapabilities.ts.
 */

export const SCAN_ROLES = ["operator", "driver", "dispatcher", "manager"];

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
];

export const SCAN_BUILT_ACTIONS = [
  "cargoAdd",
  "partAdd",
  "cargoConfirm",
  "cargoSerial",
  "stopRequireScan",
  "partSerial",
  "vehicleOpen",
  "locationSet",
];

export const SCAN_INPUT_KEYS = ["camera", "typed", "nfc"];
export const SCAN_BUILT_INPUTS = ["camera", "typed", "nfc"];

export function defaultScanRoleActions() {
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

export function defaultScanEntitlements() {
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

function mergeBoolMap(base, incoming) {
  const next = { ...base };
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return next;
  for (const [key, value] of Object.entries(incoming)) {
    if (key in next && typeof value === "boolean") next[key] = value;
  }
  return next;
}

export function mergeScanEntitlements(raw) {
  const base = defaultScanEntitlements();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  base.inputs = mergeBoolMap(base.inputs, raw.inputs);
  if (raw.roles && typeof raw.roles === "object" && !Array.isArray(raw.roles)) {
    for (const role of SCAN_ROLES) {
      base.roles[role] = mergeBoolMap(base.roles[role], raw.roles[role]);
    }
  }
  return base;
}

export function resolveFieldScan(scan, role) {
  const key = SCAN_ROLES.includes(role) ? role : "operator";
  return {
    ...scan.roles[key],
    camera: scan.inputs.camera === true,
    typed: scan.inputs.typed === true,
    nfc: scan.inputs.nfc === true,
  };
}

export function fieldScanHasInput(caps) {
  return caps?.camera === true || caps?.typed === true || caps?.nfc === true;
}

export function fieldScanAllowsContext(caps, context) {
  if (context === "dispatch_cargo") return caps?.cargoAdd === true || caps?.cargoConfirm === true;
  if (context === "maint_part") return caps?.partAdd === true;
  if (context === "vehicle") return caps?.vehicleOpen === true;
  if (context === "location") return caps?.locationSet === true;
  return (
    caps?.cargoAdd === true ||
    caps?.cargoConfirm === true ||
    caps?.partAdd === true ||
    caps?.vehicleOpen === true ||
    caps?.locationSet === true
  );
}

export function denyScanMessage(context) {
  if (context === "maint_part") return "Scan part is disabled for this role";
  if (context === "dispatch_cargo") return "Scan cargo is disabled for this role";
  if (context === "vehicle") return "Scan vehicle is disabled for this role";
  if (context === "location") return "Scan location is disabled for this role";
  return "Scan is disabled for this role";
}
