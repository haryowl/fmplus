import { useEffect, useState } from "react";
import { readStoredTheme, setTheme, THEMES, type ThemeId } from "../lib/theme";

/** Compact topbar control to switch between Warm (default) and Mono themes. */
export function ThemePicker() {
  const [theme, setLocal] = useState<ThemeId>(() => readStoredTheme());

  useEffect(() => {
    const onTheme = (e: Event) => {
      const next = (e as CustomEvent<ThemeId>).detail;
      if (next === "warm" || next === "mono") setLocal(next);
    };
    window.addEventListener("fmplus:theme", onTheme);
    return () => window.removeEventListener("fmplus:theme", onTheme);
  }, []);

  return (
    <div className="theme-picker" role="group" aria-label="Colour theme">
      {(Object.keys(THEMES) as ThemeId[]).map((id) => (
        <button
          key={id}
          type="button"
          className={`theme-picker-btn${theme === id ? " is-active" : ""}`}
          title={THEMES[id].description}
          aria-pressed={theme === id}
          onClick={() => {
            setTheme(id);
            setLocal(id);
          }}
        >
          <span className={`theme-picker-swatch theme-picker-swatch-${id}`} aria-hidden />
          {THEMES[id].label}
        </button>
      ))}
    </div>
  );
}
