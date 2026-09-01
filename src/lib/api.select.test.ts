import { describe, expect, it } from "vitest";
import { selectTrackInfosForUsers } from "./api";
import type { TrackInfo } from "./types";

describe("selectTrackInfosForUsers", () => {
  const infos: TrackInfo[] = [
    { id: 1, userId: 10 },
    { id: 2, userId: 11 },
    { id: 1, userId: 10 },
    { id: 3, userId: 10 },
    { id: 4, userId: 12 },
  ];

  it("keeps requested users and drops duplicate track ids", () => {
    const picked = selectTrackInfosForUsers(infos, [10, 12]);
    expect(picked.map((i) => i.id)).toEqual([1, 3, 4]);
  });

  it("returns empty when no ids match", () => {
    expect(selectTrackInfosForUsers(infos, [99])).toEqual([]);
  });
});
