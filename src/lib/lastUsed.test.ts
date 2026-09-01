import { describe, expect, it } from "vitest";
import { defaultFleetUserIds, parseUserIdsSearch, readLastUsed, writeFleetSelection, writeLastVehicle } from "./lastUsed";

function mem() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe("parseUserIdsSearch", () => {
  it("reads a comma list and drops junk", () => {
    expect(parseUserIdsSearch("?userIds=12,18,x,18&userId=9")).toEqual(["12", "18"]);
  });
});

describe("last used vehicle", () => {
  it("stores a single-vehicle focus without inventing a fleet set", () => {
    const storage = mem();
    writeLastVehicle("3", "99", storage);
    expect(readLastUsed(storage)).toEqual({ groupId: "3", userId: "99", fleetUserIds: [] });
  });

  it("keeps prior fleet picks for the same group when the main page updates last used", () => {
    const storage = mem();
    writeFleetSelection("3", ["10", "11"], storage);
    writeLastVehicle("3", "10", storage);
    expect(readLastUsed(storage)?.fleetUserIds).toEqual(["10", "11"]);
  });
});

describe("defaultFleetUserIds", () => {
  it("prefers explicit userIds over a single userId", () => {
    expect(
      defaultFleetUserIds({
        groupId: "1",
        queryUserIds: ["4", "5"],
        queryUserId: "9",
      }),
    ).toEqual(["4", "5"]);
  });

  it("uses the last-used vehicle when arriving with only userId", () => {
    expect(
      defaultFleetUserIds({
        groupId: "1",
        queryUserIds: [],
        queryUserId: "42",
      }),
    ).toEqual(["42"]);
  });

  it("restores a stored fleet set when the URL has no vehicle ids", () => {
    const storage = mem();
    writeFleetSelection("7", ["1", "2", "3"], storage);
    expect(
      defaultFleetUserIds({
        groupId: "7",
        queryUserIds: [],
        queryUserId: "",
        storage,
      }),
    ).toEqual(["1", "2", "3"]);
  });

  it("drops ids that are not in the current group", () => {
    expect(
      defaultFleetUserIds({
        groupId: "1",
        queryUserIds: ["1", "9"],
        queryUserId: "",
        allowedIds: ["9", "8"],
      }),
    ).toEqual(["9"]);
  });
});
