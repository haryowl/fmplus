import { isNativeFieldApp } from "./nativeField";

type NdefWriter = {
  write: (
    message: { records: Array<{ recordType: string; data: string }> },
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
};

export function webNdefAvailable(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

/** Desk Chrome/Android only. Field APK never writes. */
export function deskNfcWriteAvailable(): boolean {
  return !isNativeFieldApp() && webNdefAvailable();
}

export function deskNfcWriteBlockedReason(opts: {
  nativeField: boolean;
  hasNdef: boolean;
  sku: string;
}): string | null {
  if (!String(opts.sku || "").trim()) return "Add a SKU to write a tag";
  if (opts.nativeField) return "Field does not write NFC tags";
  if (!opts.hasNdef) return "NFC write needs Chrome on Android";
  return null;
}

export async function writeDeskNfcTag(payload: string, signal?: AbortSignal): Promise<void> {
  if (isNativeFieldApp()) throw new Error("Field does not write NFC tags");
  const text = String(payload || "").trim();
  if (!text) throw new Error("SKU is required to write a tag");
  const Ctor = (window as unknown as { NDEFReader?: new () => NdefWriter }).NDEFReader;
  if (!Ctor) throw new Error("NFC write needs Chrome on Android (HTTPS)");
  const writer = new Ctor();
  await writer.write({ records: [{ recordType: "text", data: text }] }, signal ? { signal } : undefined);
}
