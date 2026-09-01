import { describe, expect, it } from "vitest";
import { parseAiBlocks } from "./aiInsights";

describe("parseAiBlocks", () => {
  it("reads a JSON object and keeps sections in a stable order", () => {
    const blocks = parseAiBlocks(`{
      "blocks": [
        {"id":"maintenance","title":"Maintenance","body":"No urgent work."},
        {"id":"performance","title":"Performance","body":"12 km at 30 km/h."},
        {"id":"invented","title":"Skip","body":"Should drop."}
      ]
    }`);
    expect(blocks.map((b) => b.id)).toEqual(["performance", "maintenance"]);
  });

  it("unwraps a fenced JSON payload", () => {
    const blocks = parseAiBlocks("```json\n{\"blocks\":[{\"id\":\"efficiency\",\"title\":\"Fuel\",\"body\":\"8.6 km/l.\"}]}\n```");
    expect(blocks).toEqual([{ id: "efficiency", title: "Fuel", body: "8.6 km/l." }]);
  });

  it("rejects empty or unusable replies", () => {
    expect(() => parseAiBlocks("sorry, no")).toThrow(/JSON/);
    expect(() => parseAiBlocks('{"blocks":[]}')).toThrow(/usable/);
  });
});
