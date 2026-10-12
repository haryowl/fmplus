import { registerPlugin } from "@capacitor/core";
import { isNativeDispatchApp, isNativeFieldApp } from "./nativeField";

type NdefWriter = {
  write: (
    message: { records: Array<{ recordType: string; data: string }> },
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
};

type NfcWritePlugin = {
  available(): Promise<{ available: boolean; enabled: boolean }>;
  write(opts: { text: string }): Promise<{ ok?: boolean }>;
  cancel(): Promise<void>;
};

const NfcWrite = registerPlugin<NfcWritePlugin>("NfcWrite");

export function webNdefAvailable(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

/** Native Dispatch APK or Chrome Web NFC. Field APK never writes. */
export function deskNfcWriteAvailable(): boolean {
  if (isNativeFieldApp()) return false;
  if (isNativeDispatchApp()) return true;
  return webNdefAvailable();
}

export function deskNfcWriteBlockedReason(opts: {
  nativeField: boolean;
  nativeDispatch?: boolean;
  hasNdef: boolean;
  sku: string;
}): string | null {
  if (!String(opts.sku || "").trim()) return "Add a SKU to write a tag";
  if (opts.nativeField) return "Field does not write NFC tags";
  if (opts.nativeDispatch || opts.hasNdef) return null;
  return "NFC write needs Chrome on Android";
}

export async function writeDeskNfcTag(payload: string, signal?: AbortSignal): Promise<void> {
  if (isNativeFieldApp()) throw new Error("Field does not write NFC tags");
  const text = String(payload || "").trim();
  if (!text) throw new Error("SKU is required to write a tag");

  if (isNativeDispatchApp()) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const onAbort = () => {
      void NfcWrite.cancel().catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const st = await NfcWrite.available();
      if (!st.available) throw new Error("This phone has no NFC");
      if (!st.enabled) throw new Error("Turn on NFC in Android settings");
      await NfcWrite.write({ text });
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    return;
  }

  const Ctor = (window as unknown as { NDEFReader?: new () => NdefWriter }).NDEFReader;
  if (!Ctor) throw new Error("NFC write needs Chrome on Android (HTTPS)");
  const writer = new Ctor();
  await writer.write({ records: [{ recordType: "text", data: text }] }, signal ? { signal } : undefined);
}
