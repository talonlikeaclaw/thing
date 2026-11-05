import { describe, expect, it } from "vitest";

import {
  DEFAULT_RAIL,
  railKey,
  readRail,
  writeRail,
  type RailStorage,
} from "@/lib/rail";

function memoryStorage(values: Record<string, string> = {}): RailStorage {
  const store = new Map(Object.entries(values));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

const key = railKey("user-1", "space-1");

describe("railKey", () => {
  it("scopes the fold to one reader in one space", () => {
    expect(key).toBe("thing:rail:user-1:space-1");
    expect(railKey("user-2", "space-1")).not.toBe(key);
  });
});

describe("readRail", () => {
  it("shows the wide rail when nothing is stored", () => {
    expect(DEFAULT_RAIL).toBe("wide");
    expect(readRail(memoryStorage(), key)).toBe("wide");
  });

  it("reads only the stored `folded` as folded", () => {
    expect(readRail(memoryStorage({ [key]: "folded" }), key)).toBe("folded");
    expect(readRail(memoryStorage({ [key]: "wide" }), key)).toBe("wide");
    expect(readRail(memoryStorage({ [key]: "narrow" }), key)).toBe("wide");
  });

  it("survives a refused read", () => {
    const refusing: RailStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(readRail(refusing, key)).toBe("wide");
  });
});

describe("writeRail", () => {
  it("round-trips both widths", () => {
    const storage = memoryStorage();
    writeRail(storage, key, "folded");
    expect(readRail(storage, key)).toBe("folded");
    writeRail(storage, key, "wide");
    expect(readRail(storage, key)).toBe("wide");
  });

  it("swallows a refused write", () => {
    const refusing: RailStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeRail(refusing, key, "folded")).not.toThrow();
  });
});
