import type { TripMode } from "./tripMode";

export type MotionPoint = {
  ms: number;
  dateKey: string;
  ignition: boolean;
  speedKmh: number;
  logicalTripId: number | null;
};

/**
 * Split/merge a chronological GPS/CAN stream into driving trips.
 *
 * default (hybrid): start when speed > min; end on ignition off, GPS gap, or parked for breakMs.
 * speed: ignore ignition; start when moving; end on gap or parked for breakMs.
 * ignition: start on ignition on; end on ignition off or GPS gap.
 * Sessions with no moving points are discarded when minSpeedKmh > 0.
 */
export function assignLogicalTrips(
  points: MotionPoint[],
  options: { minSpeedKmh: number; breakMs: number; mode?: TripMode },
): Map<number, string> {
  const { minSpeedKmh, breakMs } = options;
  const mode: TripMode = options.mode || "default";
  const sorted = [...points].sort((a, b) => a.ms - b.ms || a.dateKey.localeCompare(b.dateKey));
  for (const point of sorted) point.logicalTripId = null;

  const moving = (point: MotionPoint) => point.speedKmh > minSpeedKmh;
  const canStart = (point: MotionPoint) => {
    if (mode === "ignition") return point.ignition;
    return moving(point);
  };
  const endOnIgnitionOff = mode !== "speed";

  const starts = new Map<number, string>();
  let nextId = 1;
  let openId: number | null = null;
  let last: MotionPoint | null = null;
  let parkFrom: number | null = null;

  const close = () => {
    openId = null;
    last = null;
    parkFrom = null;
  };

  const open = (point: MotionPoint) => {
    const id = nextId;
    nextId += 1;
    openId = id;
    point.logicalTripId = id;
    starts.set(id, point.dateKey);
    last = point;
    parkFrom = moving(point) ? null : point.ms;
  };

  for (const point of sorted) {
    if (openId === null || last === null) {
      if (canStart(point)) open(point);
      continue;
    }

    const dt = point.ms - last.ms;
    if (dt > breakMs) {
      close();
      if (canStart(point)) open(point);
      continue;
    }

    if (endOnIgnitionOff && last.ignition && !point.ignition) {
      point.logicalTripId = openId;
      close();
      continue;
    }

    if (!moving(point)) {
      if (parkFrom === null) parkFrom = moving(last) ? point.ms : last.ms;
      if (point.ms - parkFrom >= breakMs) {
        close();
        continue;
      }
    } else {
      parkFrom = null;
    }

    point.logicalTripId = openId;
    last = point;
  }

  const withMotion = new Set<number>();
  for (const point of sorted) {
    if (point.logicalTripId === null) continue;
    if (minSpeedKmh <= 0 || moving(point)) withMotion.add(point.logicalTripId);
  }
  for (const point of sorted) {
    if (point.logicalTripId !== null && !withMotion.has(point.logicalTripId)) {
      point.logicalTripId = null;
    }
  }
  for (const id of [...starts.keys()]) {
    if (!withMotion.has(id)) starts.delete(id);
  }

  return starts;
}
