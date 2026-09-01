import type { InsightBlock, InsightDepth, InsightInput } from "./insight";

export type InsightSource = "template" | "ai";

const SECTION_IDS = ["performance", "efficiency", "behavior", "road", "maintenance"] as const;

export function parseAiBlocks(raw: string): InsightBlock[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : text;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI did not return JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    throw new Error("AI JSON could not be parsed");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "blocks" in parsed
      ? (parsed as { blocks: unknown }).blocks
      : null;
  if (!Array.isArray(list)) {
    throw new Error("AI JSON missing blocks");
  }
  const byId = new Map<string, InsightBlock>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { id?: unknown; title?: unknown; body?: unknown };
    if (typeof rec.id !== "string") continue;
    if (!SECTION_IDS.includes(rec.id as (typeof SECTION_IDS)[number])) continue;
    const title = String(rec.title ?? "").trim();
    const body = String(rec.body ?? "").trim();
    if (!title || !body) continue;
    byId.set(rec.id, { id: rec.id, title, body });
  }
  const blocks = SECTION_IDS.filter((id) => byId.has(id)).map((id) => byId.get(id)!);
  if (blocks.length === 0) {
    throw new Error("AI returned no usable sections");
  }
  return blocks;
}

export async function fetchAnalyzeStatus(signal?: AbortSignal): Promise<boolean> {
  const res = await fetch("/api/analyze/status", { signal });
  if (!res.ok) return false;
  const data = (await res.json()) as { configured?: boolean };
  return data.configured === true;
}

export async function requestAiInsights(
  input: InsightInput,
  depth: InsightDepth,
): Promise<InsightBlock[]> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, depth }),
  });
  const data = (await res.json()) as { blocks?: InsightBlock[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `AI analysis failed (${res.status})`);
  }
  if (!Array.isArray(data.blocks) || data.blocks.length === 0) {
    throw new Error("AI returned no sections");
  }
  return data.blocks.filter(
    (block) =>
      block &&
      typeof block.id === "string" &&
      typeof block.title === "string" &&
      typeof block.body === "string",
  );
}
