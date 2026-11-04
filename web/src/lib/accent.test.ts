import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  DEFAULT_ACCENT,
  WASH_ALPHA,
  applyAccent,
  clearStoredAccent,
  isAccentId,
  readStoredAccent,
  resetAccent,
  storedAccentKey,
  type AccentStorage,
} from "@/lib/accent";

/** The surfaces the palettes are measured against (see `globals.css`). */
const DARK_GROUND = "#0a0e0b";
const DARK_SURFACE = "#151a16";
const DARK_RAISED = "#1d231e";
const DARK_INSET = "#070a08";
const LIGHT_GROUND = "#f1efe7";
const LIGHT_SURFACE = "#fbfaf5";
const LIGHT_RAISED = "#efede4";
const LIGHT_INSET = "#e7e4da";
const DARK_INK = "#edf1e8";
const LIGHT_INK = "#1b1d19";
const DARK_MUTED = "#a2ab9f";
const LIGHT_MUTED = "#5f665c";
/* Chrome composites over the lightest point of the ground gradient, which is
   where glass body text is at its weakest. */
const DARK_GLASS_OVER_LIFT = "#1a221c";
const LIGHT_GLASS_OVER_LIFT = "#fcfbf5";

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
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function alpha(hex: string): number {
  const value = hex.replace("#", "");
  return value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
}

/** Composite a translucent wash over an opaque ground. */
function washOver(wash: string, ground: string): string {
  const a = alpha(wash);
  const [wr, wg, wb] = channels(wash);
  const [gr, gg, gb] = channels(ground);
  const mix = (w: number, g: number) => Math.round((w * a + g * (1 - a)) * 255);
  return `#${[mix(wr, gr), mix(wg, gg), mix(wb, gb)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
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

  it.each(ACCENTS)("keeps $id on-wash text readable on its wash", ({ dark, light }) => {
    for (const ground of [DARK_GROUND, DARK_SURFACE, DARK_RAISED, DARK_INSET]) {
      expect(contrast(dark.onWash, washOver(dark.wash, ground))).toBeGreaterThanOrEqual(4.5);
    }
    for (const ground of [LIGHT_GROUND, LIGHT_SURFACE, LIGHT_RAISED, LIGHT_INSET]) {
      expect(contrast(light.onWash, washOver(light.wash, ground))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(ACCENTS)("keeps $id body ink readable on its wash", ({ dark, light }) => {
    for (const ground of [DARK_GROUND, DARK_SURFACE, DARK_RAISED, DARK_INSET]) {
      expect(contrast(DARK_INK, washOver(dark.wash, ground))).toBeGreaterThanOrEqual(4.5);
    }
    for (const ground of [LIGHT_GROUND, LIGHT_SURFACE, LIGHT_RAISED, LIGHT_INSET]) {
      expect(contrast(LIGHT_INK, washOver(light.wash, ground))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps body and metadata text readable on the glass chrome", () => {
    expect(contrast(DARK_INK, DARK_GLASS_OVER_LIFT)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK_MUTED, DARK_GLASS_OVER_LIFT)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT_INK, LIGHT_GLASS_OVER_LIFT)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT_MUTED, LIGHT_GLASS_OVER_LIFT)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(ACCENTS)("keeps $id wash tinted by its accent at the 12% ceiling", ({ dark, light }) => {
    for (const { accent, wash } of [dark, light]) {
      expect(wash.slice(0, 7)).toBe(accent);
      expect(alpha(wash)).toBeLessThanOrEqual(0.12);
      expect(alpha(wash)).toBeCloseTo(WASH_ALPHA, 5);
    }
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
