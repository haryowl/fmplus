/** Live Field host the APK WebView opens. Trailing slash and `/m` are stripped. */
export function fieldAppOrigin(raw?: string | null): string {
  const fallback = "https://81.17.100.7:4173";
  const text = String(raw || fallback).trim() || fallback;
  return text.replace(/\/+$/, "").replace(/\/m$/i, "");
}
