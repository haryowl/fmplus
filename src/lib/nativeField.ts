import { Capacitor } from "@capacitor/core";

type ArmadaNativeBridge = {
  appKind?: () => string;
  appId?: () => string;
};

function armadaNative(): ArmadaNativeBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { ArmadaNative?: ArmadaNativeBridge }).ArmadaNative;
  return bridge && typeof bridge === "object" ? bridge : null;
}

/** True inside the ARMADA Dispatch APK (Jobs + Dispatch Live desk shell). */
export function isNativeDispatchApp(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    return armadaNative()?.appKind?.() === "dispatch";
  } catch {
    return false;
  }
}

/**
 * True inside an ARMADA Field APK (online or offline).
 * False in the browser and in the Dispatch APK so desk NFC write stays available there.
 */
export function isNativeFieldApp(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  if (isNativeDispatchApp()) return false;
  return true;
}
