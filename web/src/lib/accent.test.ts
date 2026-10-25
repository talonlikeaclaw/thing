import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  DEFAULT_ACCENT,
  applyAccent,
  clearStoredAccent,
  isAccentId,
  readStoredAccent,
  resetAccent,
  storedAccentKey,
  type AccentStorage,
} from "@/lib/accent";

/** The grounds the palettes are measured against (see `globals.css`). */
const DARK_GROUND = "#121512";
const LIGHT_GROUND = "#f4f3ec";

function memoryStorage(values: Record<string, string> = {}): AccentStorage & {
  values: Map<string, string>;
} {
  const store = new Map(Object.entries(values));
  return {
    values: store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  expect(value).toHaveLength(6);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

const key = storedAccentKey("user-1", "space-1");

describe("ACCENTS", () => {
  it("is the six named accents with Lichen first", () => {
    expect(ACCENTS.map((accent) => accent.id)).toEqual([
      "lichen",
      "yellow",
      "orange",
      "cyan",
      "green",
      "pink",
    ]);
    expect(DEFAULT_ACCENT).toBe("lichen");
  });

  // The contrast floor is a contract: editing a colour below 4.5:1 fails here.
  it.each(ACCENTS)("keeps $id readable in both schemes", ({ dark, light }) => {
    expect(contrast(dark.accent, DARK_GROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark.ink, dark.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.accent, LIGHT_GROUND)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.ink, light.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("storedAccentKey", () => {
  it("scopes the old local choice to the user and the space", () => {
    expect(key).toBe("thing:accent:user-1:space-1");
  });
});

describe("readStoredAccent", () => {
  it("defaults when nothing is stored", () => {
    expect(readStoredAccent(memoryStorage(), key)).toBe("lichen");
  });

  it("defaults for an unknown id and survives a refused read", () => {
    expect(readStoredAccent(memoryStorage({ [key]: "chartreuse" }), key)).toBe("lichen");
    const refusing: AccentStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(readStoredAccent(refusing, key)).toBe("lichen");
  });

  it("reads the stored seed and the default value", () => {
    expect(readStoredAccent(memoryStorage({ [key]: "cyan" }), key)).toBe("cyan");
    expect(readStoredAccent(memoryStorage({ [key]: "lichen" }), key)).toBe(DEFAULT_ACCENT);
  });
});

describe("clearStoredAccent", () => {
  it("removes the old local choice", () => {
    const storage = memoryStorage({ [key]: "pink" });
    clearStoredAccent(storage, key);
    expect(storage.values.has(key)).toBe(false);
  });

  it("swallows a refused clear", () => {
    const refusing: AccentStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => clearStoredAccent(refusing, key)).not.toThrow();
  });
});

describe("isAccentId", () => {
  it("accepts only the six ids", () => {
    expect(isAccentId("orange")).toBe(true);
    expect(isAccentId("Orange")).toBe(false);
    expect(isAccentId(null)).toBe(false);
  });
});

describe("applyAccent", () => {
  it("sets and removes the root attribute", () => {
    const root = document.createElement("html");
    applyAccent(root, "yellow");
    expect(root.dataset.accent).toBe("yellow");
    resetAccent(root);
    expect(root.dataset.accent).toBeUndefined();
  });
});
