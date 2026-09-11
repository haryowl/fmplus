/**
 * Generate osrm-profiles/car-fmplus.lua from stock OSRM car.lua.
 * Supports api_version 4 (classes / excludable Sequence) and legacy properties.excludable.
 *
 * OSRM class names may only use [a-Z0-9] — no underscores (use ganjilgenap).
 *
 * Usage (VPS): node scripts/build-osrm-fmplus-profile.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** OSRM exclude class — letters/digits only */
const CLASS = "ganjilgenap";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const image = process.env.OSRM_IMAGE || "ghcr.io/project-osrm/osrm-backend:latest";
const outDir = path.join(root, "osrm-profiles");
const outFile = path.join(outDir, "car-fmplus.lua");
const needlesJson = path.join(root, "server", "data", "jakarta-ganjil-genap.json");

fs.mkdirSync(outDir, { recursive: true });

console.log(`==> Copy stock car.lua from ${image}`);
const src = execFileSync("docker", ["run", "--rm", image, "cat", "/opt/car.lua"], {
  encoding: "utf8",
  maxBuffer: 20_000_000,
});

const cfg = JSON.parse(fs.readFileSync(needlesJson, "utf8"));
const needles = [
  ...new Set(
    (cfg.corridors || []).flatMap((c) =>
      (c.match || [])
        .map((m) => String(m).toLowerCase().trim())
        .filter(Boolean),
    ),
  ),
];
const needlesLua = needles.map((s) => JSON.stringify(s)).join(", ");

let text = src;
let patchedExcludable = false;
let patchedClasses = false;
let patchedProcessWay = false;

// api_version 4: classes = Sequence { 'toll', 'motorway', ... }
{
  const m = text.match(/classes\s*=\s*Sequence\s*\{([^}]*)\}/);
  if (m && !m[1].includes(CLASS)) {
    text = text.replace(/classes\s*=\s*Sequence\s*\{([^}]*)\}/, (_, body) => {
      const trimmed = body.replace(/\s+$/, "");
      const sep = /,\s*$/.test(trimmed) ? "" : ",";
      return `classes = Sequence {${trimmed}${sep} '${CLASS}'}`;
    });
    patchedClasses = true;
  } else if (m) {
    patchedClasses = true;
  }
}

// api_version 4: excludable = Sequence { Set {'toll'}, ... }
{
  const marker = "excludable = Sequence {";
  const start = text.indexOf(marker);
  if (start >= 0) {
    const open = start + marker.length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > open) {
      const inner = text.slice(open + 1, end);
      if (!inner.includes(CLASS)) {
        let body = inner.replace(/\s*$/, "");
        if (!/,\s*$/.test(body)) body += ",";
        const insert = `${body}\n      Set {'${CLASS}'},\n    `;
        text = text.slice(0, open + 1) + insert + text.slice(end);
      }
      patchedExcludable = true;
    }
  }
}

// Legacy: properties.excludable = Set { ... }
if (!patchedExcludable) {
  const legacyRe = /properties\.excludable\s*=\s*Set\s*\{([^}]*)\}/;
  if (legacyRe.test(text)) {
    text = text.replace(legacyRe, (full, body) => {
      if (body.includes(CLASS)) return full;
      return `properties.excludable = Set {${body}  '${CLASS}',\n}`;
    });
    patchedExcludable = true;
  }
}

const helperBlock = `
-- ===== FM Plus Jakarta ganjil-genap helpers =====
-- Class name must be [a-Z0-9] only (OSRM rule).
local fmplus_ganjil_needles = { ${needlesLua} }

local function fmplus_is_ganjil_corridor(way)
  local tag = way:get_value_by_key("jakarta:ganjil_genap") or way:get_value_by_key("ganjil_genap")
  if tag == "yes" or tag == "true" or tag == "1" then
    return true
  end
  local name = string.lower(way:get_value_by_key("name") or "")
  local name_en = string.lower(way:get_value_by_key("name:en") or "")
  local ref = string.lower(way:get_value_by_key("ref") or "")
  local hay = name .. " " .. name_en .. " " .. ref
  for _, needle in ipairs(fmplus_ganjil_needles) do
    if needle ~= "" and string.find(hay, needle, 1, true) then
      return true
    end
  end
  return false
end

local function fmplus_mark_ganjil_corridor(way, result)
  if not fmplus_is_ganjil_corridor(way) then
    return
  end
  result.forward_classes = result.forward_classes or {}
  result.backward_classes = result.backward_classes or {}
  result.forward_classes["${CLASS}"] = true
  result.backward_classes["${CLASS}"] = true
end
-- ===== end FM Plus helpers =====
`;

if (!text.includes("fmplus_is_ganjil_corridor")) {
  if (/function process_way\s*\(/.test(text)) {
    text = text.replace(/function process_way\s*\(/, `${helperBlock}\nfunction process_way(`);
  } else {
    text = `${helperBlock}\n${text}`;
  }
}

const processWayInject = () => {
  const start = text.search(/function process_way\s*\(/);
  if (start < 0) return false;
  const afterStart = text.slice(start);
  const nextFn = afterStart.search(/\nfunction process_turn\s*\(/);
  const nextRet = afterStart.search(/\nreturn\s*\{/);
  let endRel = -1;
  if (nextFn >= 0) endRel = nextFn;
  else if (nextRet >= 0) endRel = nextRet;
  if (endRel < 0) return false;
  const fnBlock = afterStart.slice(0, endRel);
  const lastEnd = fnBlock.lastIndexOf("\nend");
  if (lastEnd < 0) return false;
  if (fnBlock.includes("fmplus_mark_ganjil_corridor")) return true;
  const abs = start + lastEnd;
  text = `${text.slice(0, abs)}\n  fmplus_mark_ganjil_corridor(way, result)\n${text.slice(abs)}`;
  return true;
};

if (!text.includes("fmplus_mark_ganjil_corridor(way, result)")) {
  patchedProcessWay = processWayInject();
}

if (!patchedExcludable) {
  console.warn(`WARNING: could not patch excludable — exclude=${CLASS} may be ignored by OSRM`);
} else {
  console.log(`==> Patched excludable (+ ${CLASS})`);
}
if (patchedClasses) console.log(`==> Patched classes (+ ${CLASS})`);
if (patchedProcessWay) console.log("==> Patched process_way (corridor class mark)");
else if (text.includes("fmplus_mark_ganjil_corridor(way, result)")) {
  console.log(`==> process_way already marks ${CLASS}`);
} else {
  console.warn("WARNING: could not patch process_way — corridors will not be tagged");
}

fs.writeFileSync(outFile, text);
console.log(`Wrote ${outFile} (${needles.length} corridor needles, class=${CLASS})`);
console.log(`
Next on VPS (example four-island graph):

  GRAPH=id-java-sumatra-kalimantan-sulawesi

  docker run --rm -t \\
    -v "$PWD/data/osrm:/data" \\
    -v "$PWD/osrm-profiles:/profiles" \\
    ${image} \\
    osrm-extract -p /profiles/car-fmplus.lua /data/$GRAPH.osm.pbf

  docker run --rm -t -v "$PWD/data/osrm:/data" ${image} \\
    osrm-partition /data/$GRAPH.osrm

  docker run --rm -t -v "$PWD/data/osrm:/data" ${image} \\
    osrm-customize /data/$GRAPH.osrm

  docker restart fmplus-osrm
`);
