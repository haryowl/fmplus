import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  formatAltitude,
  formatCoord,
  formatDistance,
  formatSpeedValue,
  readStoredUnitSystem,
  writeStoredUnitSystem,
  type UnitSystem,
} from "./units";

type UnitApi = {
  system: UnitSystem;
  setSystem: (next: UnitSystem) => void;
  distance: (km: number | null | undefined, withUnit?: boolean) => string;
  speed: (kmh: number | null | undefined, withUnit?: boolean) => string;
  altitude: (m: number | null | undefined, withUnit?: boolean) => string;
  coord: (lat: number | null | undefined, lon: number | null | undefined) => string;
  distanceUnit: string;
  speedUnit: string;
  altitudeUnit: string;
};

const UnitSystemContext = createContext<UnitApi | null>(null);

export function UnitSystemProvider({ children }: { children: ReactNode }) {
  const [system, setSystemState] = useState<UnitSystem>(() => readStoredUnitSystem());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "fmplus.unitSystem" && (e.newValue === "metric" || e.newValue === "nautical")) {
        setSystemState(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      const next = (e as CustomEvent).detail;
      if (next === "metric" || next === "nautical") setSystemState(next);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("fmplus:unitSystem", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("fmplus:unitSystem", onCustom);
    };
  }, []);

  const api = useMemo<UnitApi>(() => {
    const setSystem = (next: UnitSystem) => {
      setSystemState(next);
      writeStoredUnitSystem(next);
    };
    const dash = "—";
    return {
      system,
      setSystem,
      distance: (km, withUnit = true) =>
        km == null || !Number.isFinite(km) ? dash : formatDistance(km, system, withUnit),
      speed: (kmh, withUnit = true) =>
        kmh == null || !Number.isFinite(kmh) ? dash : formatSpeedValue(kmh, system, withUnit),
      altitude: (m, withUnit = true) =>
        m == null || !Number.isFinite(m) ? dash : formatAltitude(m, system, withUnit),
      coord: (lat, lon) =>
        lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)
          ? dash
          : formatCoord(lat, lon, system),
      distanceUnit: system === "nautical" ? "NM" : "km",
      speedUnit: system === "nautical" ? "kn" : "km/h",
      altitudeUnit: system === "nautical" ? "ft" : "m",
    };
  }, [system]);

  return <UnitSystemContext.Provider value={api}>{children}</UnitSystemContext.Provider>;
}

export function useUnitSystem(): UnitApi {
  const ctx = useContext(UnitSystemContext);
  if (!ctx) {
    throw new Error("useUnitSystem must be used within UnitSystemProvider");
  }
  return ctx;
}

/** Safe for trees that may render before the provider (tests / isolated panels). */
export function useUnitSystemOptional(): UnitApi | null {
  return useContext(UnitSystemContext);
}
