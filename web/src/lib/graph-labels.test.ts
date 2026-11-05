import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRAPH_LABELS,
  graphLabelsKey,
  readGraphLabels,
  shortTitle,
  writeGraphLabels,
  type GraphLabelStorage,
} from "@/lib/graph-labels";

function memoryStorage(values: Record<string, string> = {}): GraphLabelStorage {
  const store = new Map(Object.entries(values));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

const key = graphLabelsKey("user-1", "space-1");

describe("graphLabelsKey", () => {
  it("scopes the choice to one reader in one space", () => {
    expect(key).toBe("thing:graph-labels:user-1:space-1");
    expect(graphLabelsKey("user-2", "space-1")).not.toBe(key);
  });
});

describe("readGraphLabels", () => {
  it("shows the titles when nothing is stored", () => {
    expect(DEFAULT_GRAPH_LABELS).toBe(true);
    expect(readGraphLabels(memoryStorage(), key)).toBe(true);
  });

  it("reads only the stored `off` as hidden", () => {
    expect(readGraphLabels(memoryStorage({ [key]: "off" }), key)).toBe(false);
    expect(readGraphLabels(memoryStorage({ [key]: "on" }), key)).toBe(true);
    expect(readGraphLabels(memoryStorage({ [key]: "hidden" }), key)).toBe(true);
  });

  it("survives a refused read", () => {
    const refusing: GraphLabelStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(readGraphLabels(refusing, key)).toBe(true);
  });
});

describe("writeGraphLabels", () => {
  it("round-trips both states", () => {
    const storage = memoryStorage();
    writeGraphLabels(storage, key, false);
    expect(readGraphLabels(storage, key)).toBe(false);
    writeGraphLabels(storage, key, true);
    expect(readGraphLabels(storage, key)).toBe(true);
  });

  it("swallows a refused write", () => {
    const refusing: GraphLabelStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeGraphLabels(refusing, key, false)).not.toThrow();
  });
});

describe("shortTitle", () => {
  it("keeps a title that fits", () => {
    expect(shortTitle("Snake plant", 18)).toBe("Snake plant");
  });

  it("stops at a space instead of snipping a word", () => {
    expect(shortTitle("Monstera in the study", 18)).toBe("Monstera in the…");
    expect(shortTitle("Repot the fiddle-leaf", 18)).toBe("Repot the…");
  });

  it("hard-cuts a title with no boundary to stop at", () => {
    expect(shortTitle("Monstera", 5)).toBe("Mons…");
  });

  it("never leaves a trailing space before the ellipsis", () => {
    expect(shortTitle("Water the monstera", 11)).toBe("Water the…");
  });
});
