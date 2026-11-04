import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRAPH_LABELS,
  graphLabelsKey,
  readGraphLabels,
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
