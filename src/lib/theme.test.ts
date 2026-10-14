import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  THEMES,
  applyTheme,
  bootTheme,
  isThemeId,
  normalizeThemeId,
  readStoredTheme,
  setTheme,
} from "./theme";

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

function stubDom() {
  const attrs = new Map<string, string>();
  const meta = { content: "" };
  const root = {
    getAttribute(name: string) {
      return attrs.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
  };
  const listeners = new Map<string, Set<EventListener>>();
  const win = {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.forEach((fn) => fn(event));
      return true;
    },
  };
  vi.stubGlobal("localStorage", memStorage());
  vi.stubGlobal("document", {
    documentElement: root,
    querySelector(sel: string) {
      if (sel === 'meta[name="theme-color"]') {
        return {
          setAttribute(_name: string, value: string) {
            meta.content = value;
          },
          getAttribute() {
            return meta.content;
          },
        };
      }
      return null;
    },
  });
  vi.stubGlobal("window", win);
  return { root, meta, win };
}

describe("theme registry", () => {
  it("exposes Warm, Mono, and Modern (not legacy Color)", () => {
    expect(Object.keys(THEMES)).toEqual(["warm", "mono", "modern"]);
    expect(THEMES.modern.label).toBe("Modern");
    expect(THEMES.modern.themeColor).toBe("#0E2E3A");
    expect("color" in THEMES).toBe(false);
  });

  it("isThemeId accepts modern and rejects legacy color", () => {
    expect(isThemeId("warm")).toBe(true);
    expect(isThemeId("mono")).toBe(true);
    expect(isThemeId("modern")).toBe(true);
    expect(isThemeId("color")).toBe(false);
  });

  it("normalizeThemeId maps legacy color → modern", () => {
    expect(normalizeThemeId("modern")).toBe("modern");
    expect(normalizeThemeId("color")).toBe("modern");
    expect(normalizeThemeId("nope")).toBe(null);
  });
});

describe("theme storage + apply", () => {
  beforeEach(() => {
    stubDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to warm when nothing stored", () => {
    expect(readStoredTheme()).toBe("warm");
  });

  it("reads modern and applies data-theme + theme-color", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "modern");
    expect(readStoredTheme()).toBe("modern");
    const theme = bootTheme();
    expect(theme).toBe("modern");
    expect(document.documentElement.getAttribute("data-theme")).toBe("modern");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#0E2E3A",
    );
  });

  it("migrates legacy color in localStorage to modern on read", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "color");
    expect(readStoredTheme()).toBe("modern");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("modern");
  });

  it("setTheme persists and dispatches fmplus:theme", () => {
    const spy = vi.fn();
    window.addEventListener("fmplus:theme", spy);
    setTheme("mono");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("mono");
    expect(document.documentElement.getAttribute("data-theme")).toBe("mono");
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][0] as CustomEvent).detail).toBe("mono");
    window.removeEventListener("fmplus:theme", spy);
  });

  it("applyTheme sets warm theme-color", () => {
    applyTheme("warm");
    expect(document.documentElement.getAttribute("data-theme")).toBe("warm");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEMES.warm.themeColor,
    );
  });
});
