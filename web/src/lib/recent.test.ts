import { describe, expect, it } from "vitest";

import { readRecent, recordRecent, recentKey, type RecentStorage } from "@/lib/recent";

function memoryStorage(initial: Record<string, string> = {}): RecentStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const item = { id: "a", type: "plant", title: "Fern" };
const key = recentKey("user-1", "space-1");

describe("recentKey", () => {
  it("scopes storage to the user and the space", () => {
    expect(key).toBe("thing:recent:user-1:space-1");
  });
});

describe("readRecent", () => {
  it("returns an empty list when nothing was stored", () => {
    expect(readRecent(memoryStorage(), key)).toEqual([]);
  });

  it("returns an empty list for malformed JSON or a non-array", () => {
    expect(readRecent(memoryStorage({ [key]: "{" }), key)).toEqual([]);
    expect(readRecent(memoryStorage({ [key]: '{"id":"a"}' }), key)).toEqual([]);
  });

  it("returns an empty list when any entry is wrong-shaped", () => {
    const storage = memoryStorage({
      [key]: JSON.stringify([{ id: "a", type: "plant", title: "Fern", at: "now" }, { id: "b" }]),
    });
    expect(readRecent(storage, key)).toEqual([]);
  });

  it("caps the list at twelve entries", () => {
    const entries = Array.from({ length: 14 }, (_, index) => ({
      id: `id-${index}`,
      type: "plant",
      title: `Plant ${index}`,
      at: "2026-10-22T00:00:00Z",
    }));
    expect(readRecent(memoryStorage({ [key]: JSON.stringify(entries) }), key)).toHaveLength(12);
  });
});

describe("recordRecent", () => {
  it("prepends the newest item and stores it", () => {
    const storage = memoryStorage();
    const next = recordRecent(storage, key, item, "2026-10-22T10:00:00Z");
    expect(next).toEqual([{ ...item, at: "2026-10-22T10:00:00Z" }]);
    expect(readRecent(storage, key)).toEqual(next);
  });

  it("moves an existing id to the front with the new title and time", () => {
    const storage = memoryStorage({
      [key]: JSON.stringify([
        { id: "b", type: "plant", title: "Rose", at: "2026-10-21T10:00:00Z" },
        { ...item, at: "2026-10-20T10:00:00Z" },
      ]),
    });
    const next = recordRecent(
      storage,
      key,
      { ...item, title: "Fern (renamed)" },
      "2026-10-22T10:00:00Z",
    );
    expect(next.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(next[0]?.title).toBe("Fern (renamed)");
  });

  it("caps the list at twelve", () => {
    const storage = memoryStorage();
    let next = recordRecent(storage, key, item, "2026-10-22T10:00:00Z");
    for (let index = 0; index < 15; index += 1) {
      next = recordRecent(
        storage,
        key,
        { id: `id-${index}`, type: "plant", title: `Plant ${index}` },
        "2026-10-22T10:00:00Z",
      );
    }
    expect(next).toHaveLength(12);
    expect(next[0]?.id).toBe("id-14");
  });

  it("swallows a write the storage refuses", () => {
    const storage: RecentStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => recordRecent(storage, key, item, "2026-10-22T10:00:00Z")).not.toThrow();
    expect(recordRecent(storage, key, item, "2026-10-22T10:00:00Z")).toHaveLength(1);
  });
});
