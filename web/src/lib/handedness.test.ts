import { describe, expect, it } from "vitest";

import {
  DEFAULT_HANDEDNESS,
  applyHandedness,
  handednessKey,
  isHandedness,
  readHandedness,
  resetHandedness,
  writeHandedness,
  type HandednessStorage,
} from "@/lib/handedness";

function memoryStorage(values: Record<string, string> = {}): HandednessStorage {
  const store = new Map(Object.entries(values));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

const key = handednessKey("user-1");

describe("handednessKey", () => {
  it("scopes the preference to the user, not the space", () => {
    expect(key).toBe("thing:handedness:user-1");
  });
});

describe("readHandedness", () => {
  it("defaults to right when nothing is stored", () => {
    expect(DEFAULT_HANDEDNESS).toBe("right");
    expect(readHandedness(memoryStorage(), key)).toBe("right");
  });

  it("defaults for a malformed value and survives a refused read", () => {
    expect(readHandedness(memoryStorage({ [key]: "ambidextrous" }), key)).toBe("right");
    const refusing: HandednessStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(readHandedness(refusing, key)).toBe("right");
  });

  it("reads a stored choice", () => {
    expect(readHandedness(memoryStorage({ [key]: "left" }), key)).toBe("left");
  });
});

describe("writeHandedness", () => {
  it("round-trips a choice", () => {
    const storage = memoryStorage();
    writeHandedness(storage, key, "left");
    expect(readHandedness(storage, key)).toBe("left");
  });

  it("swallows a refused write", () => {
    const refusing: HandednessStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeHandedness(refusing, key, "left")).not.toThrow();
  });
});

describe("isHandedness", () => {
  it("accepts only the two values", () => {
    expect(isHandedness("left")).toBe(true);
    expect(isHandedness("right")).toBe(true);
    expect(isHandedness("Left")).toBe(false);
    expect(isHandedness(null)).toBe(false);
  });
});

describe("applyHandedness", () => {
  it("sets the attribute in left mode and removes it on right and reset", () => {
    const root = document.createElement("html");
    applyHandedness(root, "left");
    expect(root.dataset.hand).toBe("left");
    applyHandedness(root, "right");
    expect(root.dataset.hand).toBeUndefined();
    applyHandedness(root, "left");
    resetHandedness(root);
    expect(root.dataset.hand).toBeUndefined();
  });
});
