import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNativeFieldApp } from "./nativeField";

export type NfcTagEvent = {
  code?: string;
  uid?: string;
  fromNdef?: boolean;
};

type NfcScanPlugin = {
  available(): Promise<{ available: boolean; enabled: boolean }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  addListener(eventName: "tag", listenerFunc: (ev: NfcTagEvent) => void): Promise<PluginListenerHandle>;
};

const NfcScan = registerPlugin<NfcScanPlugin>("NfcScan");

/** Prefer the NDEF / payload string; fall back to the chip UID. */
export function preferredNfcCode(ev: NfcTagEvent | null | undefined): string {
  const code = String(ev?.code || "").trim();
  if (code) return code;
  return String(ev?.uid || "").trim();
}

export function scanSheetHint(opts: { cameraReady: boolean; typed: boolean; nfcReady: boolean }): string {
  if (opts.cameraReady && opts.nfcReady) return "Point the camera at a barcode or QR, or tap an NFC tag";
  if (opts.nfcReady) return opts.typed ? "Tap an NFC tag or type the code" : "Tap an NFC tag";
  if (opts.cameraReady) return "Point the camera at a barcode or QR";
  if (opts.typed) return "Type the SKU or barcode";
  return "Scan is disabled";
}

export function scanButtonLabel(label: string, allowNfc: boolean): string {
  if (!allowNfc) return label;
  if (label === "Scan") return "Scan or tap";
  if (label.startsWith("Scan ")) return `Scan or tap ${label.slice(5)}`;
  return label;
}

export type NfcListenResult = {
  stop: () => Promise<void>;
  ready: boolean;
  reason?: "apk" | "none" | "off" | "plugin";
};

export async function startNfcScan(onCode: (code: string) => void): Promise<NfcListenResult> {
  if (!isNativeFieldApp()) {
    return { stop: async () => undefined, ready: false, reason: "apk" };
  }
  try {
    const st = await NfcScan.available();
    if (!st.available) return { stop: async () => undefined, ready: false, reason: "none" };
    if (!st.enabled) return { stop: async () => undefined, ready: false, reason: "off" };
    const handle = await NfcScan.addListener("tag", (ev) => {
      const code = preferredNfcCode(ev);
      if (code) onCode(code);
    });
    await NfcScan.start();
    return {
      ready: true,
      stop: async () => {
        await handle.remove();
        await NfcScan.stop().catch(() => undefined);
      },
    };
  } catch {
    return { stop: async () => undefined, ready: false, reason: "plugin" };
  }
}
