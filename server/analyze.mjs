/**
 * OpenAI-compatible chat completion for vehicle analysis.
 * Used by the Vite dev middleware and by `npm start` (server.mjs).
 * Keys stay on the server — nothing here is sent to the browser.
 */

export const ANALYZE_MAX_BODY = 24 * 1024;

const SECTION_IDS = ["performance", "efficiency", "behavior", "road", "maintenance"];

const SYSTEM_PROMPT = `You are a fleet operations analyst. You receive measured vehicle metrics as JSON.
Write a concise briefing for a dispatcher. Rules:
- Use only the provided numbers. Do not invent distance, fuel, events, sensors, or locations.
- Do not mention being an AI or a language model.
- Return a JSON object: {"blocks":[{"id":"performance","title":"...","body":"..."}]}
- Allowed ids: performance, efficiency, behavior, road, maintenance.
- Omit the road block when roadSamples is 0.
- Each body is 1 to 3 sentences of plain text. No markdown, no bullet characters.
- Maintenance may recommend inspection only when the numbers support it.`;

export function aiConfigured(env = process.env) {
  return Boolean(env.AI_API_KEY && String(env.AI_API_KEY).trim());
}

export function aiSettings(env = process.env) {
  const key = String(env.AI_API_KEY || "").trim();
  const base = String(env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = String(env.AI_MODEL || "gpt-4o-mini").trim() || "gpt-4o-mini";
  return { key, base, model };
}

export function parseAiBlocks(raw) {
  const text = String(raw ?? "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : text;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI did not return JSON");
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    throw new Error("AI JSON could not be parsed");
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.blocks;
  if (!Array.isArray(list)) {
    throw new Error("AI JSON missing blocks");
  }
  const byId = new Map();
  for (const item of list) {
    if (!item || typeof item.id !== "string") continue;
    if (!SECTION_IDS.includes(item.id)) continue;
    const title = String(item.title ?? "").trim();
    const body = String(item.body ?? "").trim();
    if (!title || !body) continue;
    byId.set(item.id, { id: item.id, title, body });
  }
  const blocks = SECTION_IDS.filter((id) => byId.has(id)).map((id) => byId.get(id));
  if (blocks.length === 0) {
    throw new Error("AI returned no usable sections");
  }
  return blocks;
}

function slimInput(input) {
  const b = input?.behavior;
  return {
    gpsKm: Number(input?.gpsKm) || 0,
    activeHours: Number(input?.activeHours) || 0,
    idleHours: Number(input?.idleHours) || 0,
    avgSpeedKmh: Number(input?.avgSpeedKmh) || 0,
    avgRpm: Number(input?.avgRpm) || 0,
    maxRpm: Number(input?.maxRpm) || 0,
    fuelUsedL: Number(input?.fuelUsedL) || 0,
    canFuelUsedL: Number(input?.canFuelUsedL) || 0,
    tankFuelUsedL: Number(input?.tankFuelUsedL) || 0,
    kmPerL: Number(input?.kmPerL) || 0,
    flatKmPerL: Number(input?.flatKmPerL) || 0,
    terrainImpactPct: Number(input?.terrainImpactPct) || 0,
    elevationGainM: Number(input?.elevationGainM) || 0,
    elevationLossM: Number(input?.elevationLossM) || 0,
    altitudeSamples: Number(input?.altitudeSamples) || 0,
    roadSamples: Number(input?.roadSamples) || 0,
    roadSmoothPct: Number(input?.roadSmoothPct) || 0,
    roadRoughPct: Number(input?.roadRoughPct) || 0,
    roadBumpyPct: Number(input?.roadBumpyPct) || 0,
    avgVibrationMg: Number(input?.avgVibrationMg) || 0,
    behavior: b
      ? {
          harshBraking: Number(b.harshBraking) || 0,
          harshAcceleration: Number(b.harshAcceleration) || 0,
          harshCornering: Number(b.harshCornering) || 0,
          overspeed: Number(b.overspeed) || 0,
          totalEvents: Number(b.totalEvents) || 0,
          eventsPer100km: Number(b.eventsPer100km) || 0,
          safetyScore: Number(b.safetyScore) || 0,
          topIssue: b.topIssue ?? null,
        }
      : null,
  };
}

export async function runVehicleAnalysis(payload, env = process.env) {
  if (!aiConfigured(env)) {
    const error = new Error("AI is not configured. Set AI_API_KEY in .env.local.");
    error.status = 503;
    throw error;
  }
  const { key, base, model } = aiSettings(env);
  const depth = payload?.depth === "detailed" ? "detailed" : "standard";
  const metrics = slimInput(payload?.input);
  const body = {
    model,
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({ depth, metrics }),
      },
    ],
  };
  if (base.includes("api.openai.com")) {
    body.response_format = { type: "json_object" };
  }

  const upstream = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await upstream.text();
  if (!upstream.ok) {
    const error = new Error(`AI provider returned ${upstream.status}`);
    error.status = 502;
    throw error;
  }
  let completion;
  try {
    completion = JSON.parse(raw);
  } catch {
    const error = new Error("AI provider returned non-JSON");
    error.status = 502;
    throw error;
  }
  const content = completion?.choices?.[0]?.message?.content;
  if (!content) {
    const error = new Error("AI provider returned an empty reply");
    error.status = 502;
    throw error;
  }
  return parseAiBlocks(content);
}

export function readJsonBody(req, limit = ANALYZE_MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<boolean>}
 */
export async function handleAnalyzeRequest(req, res) {
  const url = req.url || "";
  const pathOnly = url.split("?")[0];
  const json = (status, obj) => {
    const body = JSON.stringify(obj);
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  };

  if (pathOnly === "/api/analyze/status" && req.method === "GET") {
    json(200, { configured: aiConfigured() });
    return true;
  }
  if (pathOnly === "/api/analyze" && req.method === "POST") {
    try {
      const payload = await readJsonBody(req);
      const blocks = await runVehicleAnalysis(payload);
      json(200, { blocks, source: "ai" });
    } catch (err) {
      json(err.status || 500, { error: err.message || "Analysis failed" });
    }
    return true;
  }
  if (pathOnly === "/api/analyze" || pathOnly === "/api/analyze/status") {
    json(405, { error: "Method not allowed" });
    return true;
  }
  return false;
}
