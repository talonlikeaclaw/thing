import { describe, expect, it } from "vitest";

import {
  EMOJI_RECENT_KEY,
  EMOJI_RECENT_LIMIT,
  readEmojiRecent,
  recordEmojiRecent,
} from "@/lib/emoji-recent";
import type { RecentStorage } from "@/lib/recent";

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

describe("readEmojiRecent", () => {
  it("returns an empty list when nothing was stored", () => {
    expect(readEmojiRecent(memoryStorage())).toEqual([]);
  });

  it("returns an empty list for malformed JSON or a non-array", () => {
    expect(readEmojiRecent(memoryStorage({ [EMOJI_RECENT_KEY]: "{" }))).toEqual([]);
    expect(readEmojiRecent(memoryStorage({ [EMOJI_RECENT_KEY]: '{"a":1}' }))).toEqual([]);
  });

  it("returns an empty list when any entry is wrong-shaped", () => {
    expect(readEmojiRecent(memoryStorage({ [EMOJI_RECENT_KEY]: '["🪴", 7]' }))).toEqual([]);
    expect(readEmojiRecent(memoryStorage({ [EMOJI_RECENT_KEY]: '["🪴", ""]' }))).toEqual([]);
    expect(readEmojiRecent(memoryStorage({ [EMOJI_RECENT_KEY]: `["${"a".repeat(33)}"]` }))).toEqual(
      [],
    );
  });

  it("drops duplicates and caps the list at eight", () => {
    const stored = JSON.stringify(["🪴", "🪴", ...Array.from({ length: 9 }, (_, i) => `e${i}`)]);
    const recent = readEmojiRecent(memoryStorage({ [EMOJI_RECENT_KEY]: stored }));
    expect(recent).toHaveLength(EMOJI_RECENT_LIMIT);
    expect(recent[0]).toBe("🪴");
  });

  it("returns an empty list when the storage refuses to read", () => {
    const storage: RecentStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(readEmojiRecent(storage)).toEqual([]);
  });
});

describe("recordEmojiRecent", () => {
  it("prepends the newest glyph and stores it", () => {
    const storage = memoryStorage({ [EMOJI_RECENT_KEY]: '["🪴"]' });
    expect(recordEmojiRecent(storage, "🌿")).toEqual(["🌿", "🪴"]);
    expect(storage.values.get(EMOJI_RECENT_KEY)).toBe('["🌿","🪴"]');
  });

  it("moves an existing glyph to the front without duplicating it", () => {
    const storage = memoryStorage({ [EMOJI_RECENT_KEY]: '["🪴","🌿","🌱"]' });
    expect(recordEmojiRecent(storage, "🌿")).toEqual(["🌿", "🪴", "🌱"]);
  });

  it("caps the list at eight", () => {
    const stored = JSON.stringify(Array.from({ length: EMOJI_RECENT_LIMIT }, (_, i) => `e${i}`));
    const next = recordEmojiRecent(memoryStorage({ [EMOJI_RECENT_KEY]: stored }), "🪴");
    expect(next).toHaveLength(EMOJI_RECENT_LIMIT);
    expect(next[0]).toBe("🪴");
    expect(next).not.toContain(`e${EMOJI_RECENT_LIMIT - 1}`);
  });

  it("keeps a ZWJ family glyph whole", () => {
    const storage = memoryStorage();
    expect(recordEmojiRecent(storage, "👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦"]);
  });

  it("ignores an empty or over-long value and writes nothing", () => {
    const storage = memoryStorage({ [EMOJI_RECENT_KEY]: '["🪴"]' });
    expect(recordEmojiRecent(storage, "")).toEqual(["🪴"]);
    expect(recordEmojiRecent(storage, "a".repeat(33))).toEqual(["🪴"]);
    expect(storage.values.get(EMOJI_RECENT_KEY)).toBe('["🪴"]');
  });

  it("swallows a write the storage refuses", () => {
    const storage: RecentStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(recordEmojiRecent(storage, "🪴")).toEqual(["🪴"]);
  });
});
