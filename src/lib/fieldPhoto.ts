import {
  Camera,
  CameraErrorCode,
  MediaType,
  MediaTypeSelection,
} from "@capacitor/camera";
import { prepareImageBlob } from "./imageUpload";
import { isNativeFieldApp } from "./nativeField";

export type FieldPhotoSource = "camera" | "gallery";

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object" || !("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** User backed out of the camera or gallery — not an upload failure. */
export function isFieldPhotoCancelled(err: unknown): boolean {
  const code = errorCode(err);
  if (
    code === CameraErrorCode.TakePhotoCancelled ||
    code === CameraErrorCode.ChooseMediaCancelled
  ) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /cancel/i.test(msg);
}

async function mediaToDataUrl(webPath?: string, uri?: string): Promise<string> {
  const src = webPath || uri;
  if (!src) throw new Error("No photo was returned");
  const res = await fetch(src);
  if (!res.ok) throw new Error("Could not read the photo");
  return prepareImageBlob(await res.blob());
}

/**
 * Native camera / gallery for the Field APK. The PWA keeps using a file input
 * because Chrome already offers both sources there.
 */
export async function pickFieldPhoto(source: FieldPhotoSource): Promise<string> {
  if (!isNativeFieldApp()) {
    throw new Error("Native photo picker is only available in the APK");
  }
  if (source === "camera") {
    const perm = await Camera.requestPermissions({ permissions: ["camera"] });
    if (perm.camera !== "granted") {
      throw new Error("Camera permission is blocked. Enable Camera in Android settings.");
    }
    const photo = await Camera.takePhoto({
      quality: 82,
      targetWidth: 1600,
      targetHeight: 1600,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (photo.type !== MediaType.Photo) throw new Error("Please take a photo");
    return mediaToDataUrl(photo.webPath, photo.uri);
  }
  const picked = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: false,
    quality: 82,
    targetWidth: 1600,
    targetHeight: 1600,
    correctOrientation: true,
  });
  const first = picked.results[0];
  if (!first) throw new Error("No photo was selected");
  return mediaToDataUrl(first.webPath, first.uri);
}
