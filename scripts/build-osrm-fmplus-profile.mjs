/**
 * Generate osrm-profiles/car-fmplus.lua from stock OSRM car.lua.
 * Usage (VPS): node scripts/build-osrm-fmplus-profile.mjs
 * Requires: docker (to cat /opt/car.lua from OSRM_IMAGE)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
if (!text.includes("ganjil_genap")) {
  const re = /properties\.excludable\s*=\s*Set\s*\{([^}]*)\}/;
  if (re.test(text)) {
    text = text.replace(re, (full, body) => {
      if (body.includes("ganjil_genap")) return full;
      return `properties.excludable = Set {${body}  'ganjil_genap',\n}`;
    });
  } else {
    console.warn("Could not find properties.excludable Set — append class via process_way only");
  }
}

const hook = `
-- ===== FM Plus Jakarta ganjil-genap (odd/even corridors) =====
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

local _fmplus_process_way = process_way
function process_way(profile, way, result)
  _fmplus_process_way(profile, way, result)
  if fmplus_is_ganjil_corridor(way) then
    result.forward_classes = result.forward_classes or {}
    result.backward_classes = result.backward_classes or {}
    result.forward_classes["ganjil_genap"] = true
    result.backward_classes["ganjil_genap"] = true
  end
end
-- ===== end FM Plus =====
`;

if (!text.includes("fmplus_is_ganjil_corridor")) {
  text = `${text.trimEnd()}\n\n${hook}\n`;
}

fs.writeFileSync(outFile, text);
console.log(`Wrote ${outFile} (${needles.length} corridor needles)`);
console.log("Next: re-run osrm-extract -p /profiles/car-fmplus.lua … then partition + customize");
