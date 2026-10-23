/** Official Teltonika FMB AVL Description-column enums (also used by Ruptela FM). */

const GREEN_DRIVING: Record<number, { alarmType: string; label: string }> = {
  1: { alarmType: "harsh_accel", label: "Harsh acceleration" },
  2: { alarmType: "harsh_brake", label: "Harsh braking" },
  3: { alarmType: "harsh_corner", label: "Harsh cornering" },
};

const CRASH: Record<number, string> = {
  1: "Real crash detected (device is calibrated)",
  2: "Limited crash trace (device not calibrated)",
  3: "Limited crash trace (device is calibrated)",
  4: "Full crash trace (device not calibrated)",
  5: "Full crash trace (device is calibrated)",
  6: "Real crash detected (device not calibrated)",
  9: "Real crash detected (calibration off)",
  10: "Limited crash trace (calibration off)",
  11: "Full crash trace (calibration off)",
  12: "Real crash detected (device is fully calibrated)",
  13: "Limited crash trace (device is fully calibrated)",
  14: "Full crash trace (device is fully calibrated)",
};

/** FMB Permanent I/O Elements — wiki Description column (enum values only). */
export const PERMANENT_IO: Record<number, Record<number, string>> = {
  239: { 0: "Ignition off", 1: "Ignition on" },
  240: { 0: "Movement off", 1: "Movement on" },
  80: {
    0: "Home on stop",
    1: "Home on moving",
    2: "Roaming on stop",
    3: "Roaming on moving",
    4: "Unknown on stop",
    5: "Unknown on moving",
  },
  200: {
    0: "No sleep",
    1: "GPS sleep",
    2: "Deep sleep",
    3: "Online sleep",
    4: "Ultra sleep",
  },
  69: {
    0: "GNSS off",
    1: "GNSS on with fix",
    2: "GNSS on without fix",
    3: "GNSS sleep",
    4: "GNSS on with fix, invalid data",
  },
  10: { 0: "SD not present", 1: "SD present" },
  1: { 0: "Off", 1: "On" },
  2: { 0: "Off", 1: "On" },
  3: { 0: "Off", 1: "On" },
  179: { 0: "Off", 1: "On" },
  180: { 0: "Off", 1: "On" },
  380: { 0: "Off", 1: "On" },
  381: { 0: "Off", 1: "On" },
  303: { 0: "Movement off", 1: "Movement on" },
  237: { 0: "3G", 1: "GSM", 2: "4G", 3: "LTE CAT M1", 4: "LTE CAT NB1", 99: "Unknown" },
  263: {
    0: "BT disabled",
    1: "BT enabled, not connected",
    2: "Device connected, BTv3 only",
    3: "Device connected, BLE only",
    4: "Device connected, BLE + BT",
  },
  404: {
    0: "None",
    1: "B.1 license",
    2: "B.2 license",
    3: "B.3 license",
    4: "B.4 license",
    5: "T.1 license",
    6: "T.2 license",
    7: "T.3 license",
    8: "T.4 license",
  },
  405: { 0: "None", 1: "Male", 2: "Female" },
  409: { 0: "Registered", 1: "Deregistered", 2: "Swapping" },
  383: { 0: "No calibration", 1: "Calibrated", 2: "Not configured", 3: "Fully calibrated" },
  637: { 0: "Not RTC wake", 1: "Woken by RTC alarm" },
  502: { 0: "Speed sensor off", 1: "Speed sensor on" },
};

const PARAM_AVL: Record<string, number> = {
  ignition: 239,
  "status.ignition": 239,
  "alarm.ignition": 239,
  movement: 240,
  "status.movement": 240,
  "status.moving": 240,
  "alarm.movement": 240,
  "network.data_mode": 80,
  "sleep.mode": 200,
  "gnss.status": 69,
  "sd.status": 10,
  "status.din1": 1,
  "status.din2": 2,
  "status.din3": 3,
  "status.dout1": 179,
  "status.dout2": 180,
  "status.dout3": 380,
  "ground.sense": 381,
  "network.type": 237,
  "bt.status": 263,
  "axl.calibration": 383,
  "driver.license_type": 404,
  "driver.gender": 405,
  "driver.status": 409,
  "wake.reason": 637,
};

function toInt(value: unknown): number | null {
  if (value === true) return 1;
  if (value === false) return 0;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function avlIdFromParam(paramId: string): number | null {
  const id = String(paramId || "").trim();
  if (PARAM_AVL[id] != null) return PARAM_AVL[id];
  const m = /^(?:io|avl)\.(\d+)$/i.exec(id);
  if (m) return Number(m[1]);
  if (/^\d+$/.test(id)) return Number(id);
  return null;
}

export function permanentIoLabel(paramId: string, value: unknown): string {
  const avlId = avlIdFromParam(paramId);
  const n = toInt(value);
  if (avlId == null || n == null) return "";
  return PERMANENT_IO[avlId]?.[n] || "";
}

export function formatAvlParamValue(paramId: string, value: unknown): unknown {
  const label = permanentIoLabel(paramId, value);
  return label || value;
}

export function avlIoNumber(raw: Record<string, unknown> | null | undefined, ...keys: string[]): number | null {
  if (!raw) return null;
  for (const key of keys) {
    if (raw[key] == null || raw[key] === "") continue;
    const n = toInt(raw[key]);
    if (n != null) return n;
  }
  const io = raw.io;
  if (io && typeof io === "object" && !Array.isArray(io)) {
    const nested = io as Record<string, unknown>;
    for (const key of keys) {
      const leaf = key.startsWith("io.") ? key.slice(3) : key;
      if (nested[leaf] == null) continue;
      const n = toInt(nested[leaf]);
      if (n != null) return n;
    }
  }
  return null;
}

const IO_ATTR_KEYS = [
  "io_value",
  "io_label",
  "event_io",
  "green_driving.value",
  "green_driving.label",
  "crash.value",
  "crash.label",
  "ignition.value",
  "ignition.label",
  "status.ignition",
  "ignition",
  "movement.value",
  "movement.label",
  "status.movement",
  "status.moving",
  "movement",
  "253",
  "247",
  "239",
  "240",
  "io.253",
  "io.247",
  "io.239",
  "io.240",
  "io.243",
];

function pickNestedIo(src: Record<string, unknown>, out: Record<string, unknown>) {
  const io = src.io;
  if (!io || typeof io !== "object" || Array.isArray(io)) return;
  const nested = io as Record<string, unknown>;
  for (const id of ["253", "247", "239", "240", "243"]) {
    if (nested[id] != null && out[`io.${id}`] == null) out[`io.${id}`] = nested[id];
  }
}

/** Merge event + matching-fix attrs so Alerts/History can decode Description enums. */
export function mergeAvlEventAttrs(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const src of sources) {
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    for (const key of IO_ATTR_KEYS) {
      if (src[key] != null && src[key] !== "") out[key] = src[key];
    }
    pickNestedIo(src, out);
  }
  return out;
}

export function eventIoValue(
  alarmType: string,
  attrs: Record<string, unknown> | null | undefined,
): number | null {
  const type = String(alarmType || "").toLowerCase();
  if (type === "green_driving" || type.startsWith("harsh_")) {
    return avlIoNumber(attrs, "green_driving.value", "io.253", "io_value", "253");
  }
  if (type === "crash") {
    return avlIoNumber(attrs, "crash.value", "io.247", "io_value", "247");
  }
  if (type === "ignition") {
    return avlIoNumber(attrs, "ignition.value", "io.239", "io_value", "239", "status.ignition", "ignition");
  }
  if (type === "movement") {
    return avlIoNumber(
      attrs,
      "movement.value",
      "io.240",
      "io_value",
      "240",
      "status.movement",
      "status.moving",
      "movement",
    );
  }
  return avlIoNumber(attrs, "io_value", "green_driving.value", "crash.value", "253", "247");
}

export function avlIoLabel(alarmType: string, value: number | null | undefined): string {
  const type = String(alarmType || "").toLowerCase();
  const n = value == null ? NaN : Number(value);
  if (!Number.isFinite(n)) return "";
  if (type === "green_driving" || type.startsWith("harsh_")) {
    return GREEN_DRIVING[n]?.label || "";
  }
  if (type === "crash") return CRASH[n] || "";
  if (type === "ignition") return PERMANENT_IO[239]?.[n] || "";
  if (type === "movement") return PERMANENT_IO[240]?.[n] || "";
  return "";
}
