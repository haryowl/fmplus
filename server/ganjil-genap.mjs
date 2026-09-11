/**
 * Jakarta ganjil–genap (odd/even plate) — schedule + plate matching.
 * Hard road avoidance needs OSRM graph built with car-fmplus.lua (class ganjilgenap).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {object | null} */
let cachedConfig = null;

export function loadGanjilGenapConfig() {
  if (cachedConfig) return cachedConfig;
  const file = path.join(__dirname, "data", "jakarta-ganjil-genap.json");
  try {
    cachedConfig = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    cachedConfig = {
      timezone: "Asia/Jakarta",
      windows: [
        { start: "06:00", end: "10:00" },
        { start: "16:00", end: "21:00" },
      ],
      weekdays: [1, 2, 3, 4, 5],
      holidays: [],
      corridors: [],
    };
  }
  return cachedConfig;
}

/** @param {string} hhmm */
function parseHm(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Calendar parts in Asia/Jakarta for a Date (or "now").
 * @param {Date | string | number | null | undefined} at
 */
export function jakartaWallClock(at = null) {
  const d = at == null ? new Date() : at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return jakartaWallClock(new Date());
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const minutes = hour * 60 + minute;
  // en-CA weekday: Mon..Sun
  const wdMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const weekday = wdMap[parts.weekday] || 1;
  const dayOfMonth = Number(parts.day);
  return { ymd, minutes, weekday, dayOfMonth, hour, minute };
}

/** @param {string} ymd @param {string} hm */
export function jakartaDateTimeFromYmdAndHm(ymd, hm) {
  const day = String(ymd || "").slice(0, 10);
  const clock = String(hm || "08:00").trim() || "08:00";
  // Interpret as WIB (UTC+7)
  const iso = `${day}T${clock.length === 5 ? clock : "08:00"}:00+07:00`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : new Date();
}

/**
 * @param {"odd"|"even"|"unknown"|"exempt"|string|null|undefined} parity
 */
export function normalizePlateParity(parity) {
  const s = String(parity || "")
    .toLowerCase()
    .trim();
  if (s === "odd" || s === "ganjil" || s === "1") return "odd";
  if (s === "even" || s === "genap" || s === "0" || s === "2") return "even";
  if (s === "exempt" || s === "bebas" || s === "official") return "exempt";
  return "unknown";
}

/** Last digit of plate string → odd/even/unknown */
export function plateParityFromPlate(plate) {
  const digits = String(plate || "").replace(/\D/g, "");
  if (!digits) return "unknown";
  const last = Number(digits[digits.length - 1]);
  if (!Number.isFinite(last)) return "unknown";
  return last % 2 === 0 ? "even" : "odd";
}

/** Calendar day in Jakarta: odd date → odd plates allowed on corridors. */
export function allowedParityForDate(dayOfMonth) {
  const n = Number(dayOfMonth);
  if (!Number.isFinite(n)) return "unknown";
  return n % 2 === 0 ? "even" : "odd";
}

/**
 * @param {Date | string | number | null} [at]
 * @param {object} [config]
 */
export function isGanjilGenapActive(at = null, config = null) {
  const cfg = config || loadGanjilGenapConfig();
  const wall = jakartaWallClock(at);
  const holidays = new Set((cfg.holidays || []).map((x) => String(x).slice(0, 10)));
  if (holidays.has(wall.ymd)) {
    return { active: false, reason: "holiday", ...wall, allowedParity: allowedParityForDate(wall.dayOfMonth) };
  }
  const weekdays = Array.isArray(cfg.weekdays) && cfg.weekdays.length ? cfg.weekdays : [1, 2, 3, 4, 5];
  if (!weekdays.includes(wall.weekday)) {
    return { active: false, reason: "weekend", ...wall, allowedParity: allowedParityForDate(wall.dayOfMonth) };
  }
  const windows = Array.isArray(cfg.windows) ? cfg.windows : [];
  let inWindow = false;
  for (const w of windows) {
    const a = parseHm(w.start);
    const b = parseHm(w.end);
    if (a == null || b == null) continue;
    if (wall.minutes >= a && wall.minutes < b) {
      inWindow = true;
      break;
    }
  }
  if (!inWindow) {
    return { active: false, reason: "outside_hours", ...wall, allowedParity: allowedParityForDate(wall.dayOfMonth) };
  }
  return {
    active: true,
    reason: "in_force",
    ...wall,
    allowedParity: allowedParityForDate(wall.dayOfMonth),
  };
}

/**
 * Should this vehicle avoid ganjil–genap corridors at `at`?
 * @param {object} input
 * @param {"odd"|"even"|"unknown"|"exempt"|string|null} [input.plateParity]
 * @param {Date|string|number|null} [input.at]
 * @param {boolean} [input.respect] — false disables
 */
export function ganjilGenapDecision(input = {}) {
  const respect = input.respect !== false;
  const parity = normalizePlateParity(input.plateParity);
  const status = isGanjilGenapActive(input.at);
  const className =
    String(process.env.OSRM_GANJIL_GENAP_CLASS || "ganjilgenap")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "ganjilgenap";
  const restrictedUrl = String(
    process.env.OSRM_BASE_URL_RESTRICTED || process.env.OSRM_RESTRICTED_URL || "",
  )
    .trim()
    .replace(/\/+$/, "");

  if (!respect) {
    return {
      ...status,
      plateParity: parity,
      avoidCorridors: false,
      excludeClass: null,
      useRestrictedBase: false,
      restrictedBaseUrl: restrictedUrl || null,
      summary: "ganjil–genap ignored",
    };
  }
  if (parity === "exempt") {
    return {
      ...status,
      plateParity: parity,
      avoidCorridors: false,
      excludeClass: null,
      useRestrictedBase: false,
      restrictedBaseUrl: restrictedUrl || null,
      summary: "plate exempt",
    };
  }
  if (!status.active) {
    return {
      ...status,
      plateParity: parity,
      avoidCorridors: false,
      excludeClass: null,
      useRestrictedBase: false,
      restrictedBaseUrl: restrictedUrl || null,
      summary: `not in force (${status.reason})`,
    };
  }
  if (parity === "unknown") {
    return {
      ...status,
      plateParity: parity,
      avoidCorridors: true,
      excludeClass: className,
      useRestrictedBase: Boolean(restrictedUrl),
      restrictedBaseUrl: restrictedUrl || null,
      summary: "in force · plate unknown → avoid corridors",
    };
  }
  const mismatch = parity !== status.allowedParity;
  return {
    ...status,
    plateParity: parity,
    avoidCorridors: mismatch,
    excludeClass: mismatch ? className : null,
    useRestrictedBase: Boolean(mismatch && restrictedUrl),
    restrictedBaseUrl: restrictedUrl || null,
    summary: mismatch
      ? `in force · ${parity} plate on ${status.allowedParity} date → avoid corridors`
      : `in force · ${parity} plate matches date`,
  };
}

export function corridorMatchNeedles(config = null) {
  const cfg = config || loadGanjilGenapConfig();
  const needles = [];
  for (const c of cfg.corridors || []) {
    for (const m of c.match || []) {
      const s = String(m || "")
        .toLowerCase()
        .trim();
      if (s) needles.push(s);
    }
  }
  return [...new Set(needles)];
}
