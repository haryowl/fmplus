/** Resize/compress camera images so mobile uploads fit API body limits. */

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Returns a JPEG (or original if canvas fails) data URL small enough for field/maintenance upload.
 */
export async function prepareImageDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error("Please choose an image file");
  }
  const raw = await readFileAsDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return raw;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const jpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (jpeg.length > 100 && jpeg.length < raw.length) return jpeg;
    if (jpeg.length > 100) return jpeg;
    return raw;
  } catch {
    return raw;
  }
}
