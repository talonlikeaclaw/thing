import { describe, expect, it } from "vitest";

import { EMOJI_GROUPS, searchEmoji } from "@/lib/emoji";

describe("emoji search", () => {
  it("matches every term against names and keywords, case-insensitively", () => {
    expect(searchEmoji("PLANT").map((entry) => entry.char)).toContain("🪴");
    expect(searchEmoji("chore").map((entry) => entry.char)).toContain("🧹");
    expect(searchEmoji("garden green").map((entry) => entry.char)).toContain("🪴");
  });

  it("returns nothing for a blank or unmatched query", () => {
    expect(searchEmoji("  ")).toEqual([]);
    expect(searchEmoji("zzzz")).toEqual([]);
  });

  it("does not repeat an emoji that appears in two groups", () => {
    const chars = searchEmoji("plant", 100).map((entry) => entry.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("keeps every catalogue entry searchable by its own name", () => {
    for (const group of EMOJI_GROUPS) {
      for (const entry of group.entries) {
        expect(searchEmoji(entry.name, 100).map((found) => found.char)).toContain(entry.char);
      }
    }
  });
});
