import { useState, type ChangeEvent } from "react";
import { isFieldPhotoCancelled, pickFieldPhoto } from "../lib/fieldPhoto";
import { prepareImageDataUrl } from "../lib/imageUpload";
import { isNativeFieldApp } from "../lib/nativeField";

type Props = {
  disabled?: boolean;
  onPick: (dataUrl: string) => void | Promise<void>;
  onError?: (message: string) => void;
};

/**
 * PWA: one file input (browser already offers camera + gallery).
 * APK: native Take photo / From gallery so OEM WebViews cannot hide the camera.
 */
export function FieldPhotoPicker({ disabled, onPick, onError }: Props) {
  const native = isNativeFieldApp();
  const [picking, setPicking] = useState(false);
  const busy = Boolean(disabled || picking);

  async function fromNative(source: "camera" | "gallery") {
    setPicking(true);
    try {
      await onPick(await pickFieldPhoto(source));
    } catch (err) {
      if (isFieldPhotoCancelled(err)) return;
      onError?.(err instanceof Error ? err.message : "Could not get photo");
    } finally {
      setPicking(false);
    }
  }

  async function fromFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPicking(true);
    try {
      await onPick(await prepareImageDataUrl(file));
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not read photo");
    } finally {
      setPicking(false);
    }
  }

  if (native) {
    return (
      <div className="field-photo-actions">
        <button type="button" className="field-photo-btn" disabled={busy} onClick={() => void fromNative("camera")}>
          Take photo
        </button>
        <button type="button" className="field-photo-btn" disabled={busy} onClick={() => void fromNative("gallery")}>
          From gallery
        </button>
      </div>
    );
  }

  return (
    <label className="field-photo-btn">
      Take / upload photo
      <input type="file" accept="image/*" capture="environment" hidden disabled={busy} onChange={(e) => void fromFile(e)} />
    </label>
  );
}
