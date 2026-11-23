import { describe, expect, it, vi } from "vitest";

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
  syncThemeColor,
  type AccentStorage,
} from "@/lib/accent";

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

function alpha(hex: string): number {
  const value = hex.replace("#", "");
  return value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
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

  // Contrast is measured against the themed room in `styles/theme.test.ts`.
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

describe("syncThemeColor", () => {
  it("writes the room ground to the current scheme's meta only", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("prefers-color-scheme: dark"),
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    document.head.innerHTML =
      '<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />' +
      '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />';
    const root = document.createElement("html");
    root.style.setProperty("--color-ground", "oklch(0.2 0.01 200)");

    syncThemeColor(root);

    const [dark, light] = [
      ...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
    ];
    expect(dark?.content).toBe("oklch(0.2 0.01 200)");
    expect(light?.content).toBe("#ffffff");
    vi.restoreAllMocks();
  });
});
