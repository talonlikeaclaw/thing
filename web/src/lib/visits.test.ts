import { describe, expect, it } from "vitest";

import {
  readVisits,
  recordVisit,
  sortByVisit,
  visitsKey,
  type VisitStorage,
} from "@/lib/visits";

function memoryStorage(values: Record<string, string> = {}): VisitStorage & {
  values: Map<string, string>;
} {
  const store = new Map(Object.entries(values));
  return {
    values: store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

const key = visitsKey("user-1");

describe("visitsKey", () => {
  it("scopes visits to the user", () => {
    expect(key).toBe("thing:visited:user-1");
  });
});

describe("readVisits", () => {
  it("returns an empty map for missing or malformed values", () => {
    expect(readVisits(memoryStorage(), key)).toEqual({});
    expect(readVisits(memoryStorage({ [key]: "{" }), key)).toEqual({});
    expect(readVisits(memoryStorage({ [key]: "[]" }), key)).toEqual({});
    expect(readVisits(memoryStorage({ [key]: '"space"' }), key)).toEqual({});
  });

  it("keeps only finite non-negative numbers", () => {
    const storage = memoryStorage({
      [key]: JSON.stringify({ a: 10, b: -1, c: "12", d: null, e: 2.5 }),
    });
    expect(readVisits(storage, key)).toEqual({ a: 10, e: 2.5 });
  });
});

describe("recordVisit", () => {
  it("upserts one space and swallows a refused write", () => {
    const storage = memoryStorage({ [key]: JSON.stringify({ a: 10 }) });
    expect(recordVisit(storage, key, "b", 20)).toEqual({ a: 10, b: 20 });
    expect(readVisits(storage, key)).toEqual({ a: 10, b: 20 });

    expect(() =>
      recordVisit(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
        },
        key,
        "a",
        30,
      ),
    ).not.toThrow();
  });
});

describe("sortByVisit", () => {
  it("puts the most recently visited first and falls back to name", () => {
    const spaces = [
      { id: "2", name: "Garden" },
      { id: "1", name: "Studio" },
      { id: "3", name: "Archive" },
    ];
    expect(sortByVisit(spaces, { "1": 10, "3": 20 }).map((space) => space.id)).toEqual([
      "3",
      "1",
      "2",
    ]);
    expect(sortByVisit(spaces, {}).map((space) => space.name)).toEqual([
      "Archive",
      "Garden",
      "Studio",
    ]);
  });
});
