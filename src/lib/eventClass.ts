export type EventClass = "safety" | "warning" | "asset" | "none";
export type EventEmitOn = "event" | "rising" | "falling" | "change" | "none";

export type EventClassInfo = {
  eventClass: EventClass;
  raiseAlert: boolean;
  emitOn: EventEmitOn;
  label?: string;
};

const SAFETY: EventClassInfo = { eventClass: "safety", raiseAlert: true, emitOn: "event" };
const WARNING: EventClassInfo = { eventClass: "warning", raiseAlert: true, emitOn: "event" };
const ASSET_CHANGE: EventClassInfo = { eventClass: "asset", raiseAlert: false, emitOn: "change" };
const ASSET_EVENT: EventClassInfo = { eventClass: "asset", raiseAlert: false, emitOn: "event" };
const NONE: EventClassInfo = { eventClass: "none", raiseAlert: false, emitOn: "none" };

/** Seeded defaults. Device Mapper overrides win at read/ingest time. */
export const DEFAULT_EVENT_CLASS_BY_TYPE: Record<string, EventClassInfo> = {
  green_driving: { ...SAFETY, label: "Green driving" },
  overspeed: { ...SAFETY, label: "Overspeed" },
  crash: { ...SAFETY, label: "Crash" },
  impact: { ...SAFETY, label: "Impact" },
  tilt: { ...SAFETY, label: "Tilt" },
  harsh_brake: { ...SAFETY, label: "Harsh brake" },
  harsh_accel: { ...SAFETY, label: "Harsh acceleration" },
  harsh_corner: { ...SAFETY, label: "Harsh corner" },
  ignition: { ...ASSET_CHANGE, label: "Ignition" },
  movement: { ...ASSET_CHANGE, label: "Movement" },
  trip: { ...ASSET_EVENT, label: "Trip" },
  door: { ...ASSET_EVENT, label: "Door" },
  idling: { ...ASSET_EVENT, label: "Idling" },
  geofence: { ...ASSET_EVENT, label: "Geofence" },
  autogeofence: { ...ASSET_EVENT, label: "Auto geofence" },
  power_ext: { ...WARNING, label: "External power" },
  unplug: { ...WARNING, label: "Unplug" },
  jamming: { ...WARNING, label: "Jamming" },
  gnss_antenna: { ...WARNING, label: "GNSS antenna" },
  battery_low: { ...WARNING, label: "Battery low" },
  towing: { ...WARNING, label: "Towing" },
  sos: { ...WARNING, label: "SOS" },
  fuel_theft: { ...WARNING, label: "Fuel theft" },
  sim_missing: { ...WARNING, label: "SIM missing" },
  ext_voltage: { ...WARNING, label: "External voltage" },
  bus_voltage: { ...WARNING, label: "Bus voltage" },
  video_loss: { ...NONE, label: "Video loss" },
  video_lost: { ...NONE, label: "Video lost" },
  snapshot: { ...NONE, label: "Snapshot" },
  photo: { ...NONE, label: "Photo" },
  media: { ...NONE, label: "Media" },
};

export const EVENT_CLASS_LABELS: Record<EventClass, string> = {
  safety: "Safety",
  warning: "Warning",
  asset: "Asset",
  none: "Hidden",
};

export function normalizeAlarmType(type: string | null | undefined): string {
  return String(type || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function classifyAlarmType(
  alarmType: string | null | undefined,
  override?: Partial<EventClassInfo> | null,
): EventClassInfo {
  if (override && override.eventClass) {
    return {
      eventClass: override.eventClass,
      raiseAlert:
        override.raiseAlert ??
        (override.eventClass === "safety" || override.eventClass === "warning"),
      emitOn: override.emitOn || "event",
      label: override.label,
    };
  }
  const key = normalizeAlarmType(alarmType);
  const seeded = DEFAULT_EVENT_CLASS_BY_TYPE[key];
  if (seeded) return { ...seeded };
  if (key.startsWith("harsh_") || key.startsWith("adas_") || key.startsWith("dsm_")) {
    return { ...SAFETY, label: alarmType || key };
  }
  if (key.includes("video") || key.includes("photo") || key.includes("snapshot")) {
    return { ...NONE, label: alarmType || key };
  }
  return { ...WARNING, label: alarmType || key };
}

export function eventClassLabel(cls: EventClass): string {
  return EVENT_CLASS_LABELS[cls] || cls;
}
