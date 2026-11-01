import { describe, expect, it } from "vitest";

import { matchRanges, rank, score } from "@/lib/search";

describe("score", () => {
  it("matches case-insensitively as a subsequence", () => {
    expect(score("PLT", "Plant")).not.toBeNull();
    expect(score("pnt", "Plant")).not.toBeNull();
  });

  it("returns null when the query is not a subsequence", () => {
    expect(score("xyz", "Plant")).toBeNull();
    expect(score("tp", "Plant")).toBeNull();
  });

  it("scores an empty query as zero", () => {
    expect(score("", "Plant")).toBe(0);
    expect(score("   ", "Plant")).toBe(0);
  });

  it("ranks a prefix above the same match inside a word", () => {
    const prefix = score("plan", "Plant");
    const inside = score("plan", "Replant");
    expect(prefix).not.toBeNull();
    expect(inside).not.toBeNull();
    expect(prefix ?? 0).toBeGreaterThan(inside ?? 0);
  });

  it("ranks a word-boundary match above a mid-word match", () => {
    const boundary = score("room", "By room");
    const inside = score("room", "Bedroom");
    expect(boundary ?? 0).toBeGreaterThan(inside ?? 0);
  });

  it("ranks adjacent characters above gaps", () => {
    const adjacent = score("abc", "abc");
    const gapped = score("abc", "a_b_c");
    expect(adjacent ?? 0).toBeGreaterThan(gapped ?? 0);
  });
});

describe("rank", () => {
  it("keeps input order for an empty query", () => {
    const items = ["Beta", "Alpha"];
    expect(rank("", items, (item) => item)).toEqual(items);
  });

  it("sorts by score, then by the original order", () => {
    const items = ["A large plant", "Plant", "Planter"];
    expect(rank("plan", items, (item) => item)).toEqual(["Plant", "Planter", "A large plant"]);
  });

  it("drops non-matches", () => {
    expect(rank("ro", ["Rose", "Fern", "Rosemary"], (item) => item)).toEqual([
      "Rose",
      "Rosemary",
    ]);
  });
});

describe("matchRanges", () => {
  it("marks every occurrence of a query token, case-insensitively", () => {
    expect(matchRanges("The soil stays moist.", "moist")).toEqual([[15, 20]]);
    expect(matchRanges("Moist soil, more MOIST.", "moist")).toEqual([
      [0, 5],
      [17, 22],
    ]);
  });

  it("merges overlapping tokens and drops duplicates", () => {
    expect(matchRanges("plant", "plan plant plan")).toEqual([[0, 5]]);
  });

  it("marks nothing for punctuation or an empty query", () => {
    expect(matchRanges("The soil is moist.", "!!!")).toEqual([]);
    expect(matchRanges("The soil is moist.", "   ")).toEqual([]);
  });

  it("keeps ranges in text order after merging", () => {
    expect(matchRanges("water the ficus, then water again", "again water")).toEqual([
      [0, 5],
      [22, 27],
      [28, 33],
    ]);
  });
});
