import { Capacitor } from "@capacitor/core";

/** True inside the ARMADA Field APK, false in the browser PWA. */
export function isNativeFieldApp(): boolean {
  return Capacitor.isNativePlatform();
}
