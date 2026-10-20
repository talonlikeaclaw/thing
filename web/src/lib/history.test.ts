import { describe, expect, it } from "vitest";

import type { Revision } from "@/api/types";
import { revisionDiff } from "@/lib/history";

function revision(
  rev: number,
  changed: string[],
  title: string,
  properties: Record<string, unknown>,
  body?: string,
): Revision {
  return {
    rev,
    at: "2026-10-20T12:00:00Z",
    by: "01a15ae7-3525-7657-99bf-c76a122fe8ee",
    action: "update",
    snapshot: { title, properties },
    changed,
    ...(body === undefined ? {} : { body }),
  };
}

describe("revision diff", () => {
  it("shows every value of the first revision as new", () => {
    const first = revision(1, ["title", "room", "body"], "Monstera", { room: "kitchen" }, "Watered.");
    expect(revisionDiff(first, undefined)).toEqual([
      { key: "title", before: null, after: "Monstera" },
      { key: "room", before: null, after: "kitchen" },
    ]);
  });

  it("reads before from the previous snapshot for changed, added and dropped keys", () => {
    const before = revision(1, ["title"], "Monstera", { room: "kitchen", tags: ["easy"] });
    const after = revision(2, ["title", "room", "last_watered", "tags"], "Monstera II", {
      room: "study",
      last_watered: "2026-10-20",
    });
    expect(revisionDiff(after, before)).toEqual([
      { key: "title", before: "Monstera", after: "Monstera II" },
      { key: "room", before: "kitchen", after: "study" },
      { key: "last_watered", before: null, after: "2026-10-20" },
      { key: "tags", before: ["easy"], after: null },
    ]);
  });

  it("leaves the body out of the property diff", () => {
    const before = revision(1, ["title"], "Monstera", {});
    const after = revision(2, ["body"], "Monstera", {}, "A new paragraph.");
    expect(revisionDiff(after, before)).toEqual([]);
    expect(after.body).toBe("A new paragraph.");
  });
});
