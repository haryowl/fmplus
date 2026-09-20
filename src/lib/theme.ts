/** App colour themes. `warm` is the original palette; `mono` is black & white. */

export const THEME_STORAGE_KEY = "fmplus.theme";

export const THEMES = {
  warm: {
    id: "warm",
    label: "Warm",
    description: "Sand & teal (default)",
    themeColor: "#141311",
  },
  mono: {
    id: "mono",
    label: "Mono",
    description: "Black & white",
    themeColor: "#0a0a0a",
  },
} as const;

export type ThemeId = keyof typeof THEMES;

export function isThemeId(value: unknown): value is ThemeId {
  return value === "warm" || value === "mono";
}

export function readStoredTheme(): ThemeId {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "warm";
}

/** Apply theme to <html> and sync the mobile theme-color meta tag. */
export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEMES[theme].themeColor);
}

export function setTheme(theme: ThemeId): void {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("fmplus:theme", { detail: theme }));
}

/** Boot theme before first paint of React trees that depend on CSS vars. */
export function bootTheme(): ThemeId {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}
