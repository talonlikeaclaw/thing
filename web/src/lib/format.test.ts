import { describe, expect, it } from "vitest";

import type { PropertyDef } from "@/api/types";
import {
  datetimeLocal,
  formatBytes,
  fromDatetimeLocal,
  isBlank,
  optionName,
  parseCellText,
  plural,
  relationChips,
  relativeTime,
  typeLabel,
  valueLabel,
} from "@/lib/format";

const status: PropertyDef = {
  key: "status",
  name: "Status",
  format: "select",
  options: [{ key: "todo", name: "To do", color: "#c8d96b" }],
};

describe("plural", () => {
  it("uses the singular for one and the plural otherwise", () => {
    expect(plural(0, "result")).toBe("0 results");
    expect(plural(1, "result")).toBe("1 result");
    expect(plural(2, "result")).toBe("2 results");
  });

  it("accepts an irregular plural", () => {
    expect(plural(1, "entry", "entries")).toBe("1 entry");
    expect(plural(3, "entry", "entries")).toBe("3 entries");
  });
});

describe("cell labels", () => {
  it("renders options by name and unknown keys as themselves", () => {
    expect(valueLabel("select", "todo", status)).toBe("To do");
    expect(valueLabel("select", "gone", status)).toBe("gone");
    expect(optionName(status, "gone")).toBe("gone");
  });

  it("joins multi values and resolves relation titles when known", () => {
    expect(valueLabel("multi_select", ["todo", "gone"], status)).toBe("To do, gone");
    const titles = new Map([["a", "Fern"], ["b", "Monstera"]]);
    expect(valueLabel("relation", ["a", "b"], undefined, titles)).toBe("Fern, Monstera");
    expect(valueLabel("relation", "c", undefined, titles)).toBe("c");
  });

  it("labels a recurrence mapping and refuses it as text", () => {
    expect(valueLabel("recurrence", { kind: "weekly", every: 2, weekday: 1 }, undefined)).toBe(
      "Every 2 weeks on Monday",
    );
    expect(parseCellText("recurrence", "every 2 weeks")).toBeUndefined();
  });

  it("treats empty values as blank and others as their plain text", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank(false)).toBe(false);
    expect(valueLabel("number", 2.5, undefined)).toBe("2.5");
  });
});

describe("cell parsing", () => {
  it("clears blank text and rejects malformed numbers", () => {
    expect(parseCellText("text", "   ")).toBeNull();
    expect(parseCellText("number", "42")).toBe(42);
    expect(parseCellText("number", "4o")).toBeUndefined();
  });

  it("keeps dates as calendar strings and normalizes datetimes", () => {
    expect(parseCellText("date", "2026-10-20")).toBe("2026-10-20");
    expect(parseCellText("date", "2026-13-40")).toBeUndefined();
    const local = "2026-10-20T14:30";
    expect(parseCellText("datetime", local)).toBe(new Date(local).toISOString());
  });
});

describe("datetime fields", () => {
  it("round-trips an instant through the local input format", () => {
    const local = "2026-10-20T14:30";
    const iso = fromDatetimeLocal(local);
    expect(iso).not.toBeNull();
    expect(datetimeLocal(iso)).toBe(local);
  });

  it("returns nothing for an unreadable instant", () => {
    expect(datetimeLocal("not a date")).toBe("");
    expect(fromDatetimeLocal("")).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");

  it("uses whole units around the reference instant", () => {
    expect(relativeTime("2026-10-23T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-23T10:00:00Z", now)).toBe("2 hours ago");
    expect(relativeTime("2026-10-22T12:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-10-25T12:00:00Z", now)).toBe("in 2 days");
  });

  it("returns nothing for an unreadable instant", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("typeLabel", () => {
  const types = [{ key: "plant", name: "Plant" }];

  it("resolves a type key to its display name", () => {
    expect(typeLabel(types, "plant")).toBe("Plant");
  });

  it("falls back to the key while the type list is unknown or stale", () => {
    expect(typeLabel(undefined, "plant")).toBe("plant");
    expect(typeLabel([], "plant")).toBe("plant");
    expect(typeLabel(types, "chore")).toBe("chore");
  });
});

describe("relationChips", () => {
  const a = "0199a0c0-0000-7000-8000-00000000000a";
  const b = "0199a0c0-0000-7000-8000-00000000000b";

  it("needs no target fetch: a joined label splits into one chip per id", () => {
    expect(relationChips([a], "Fern")).toEqual([{ id: a, title: "Fern" }]);
    expect(relationChips([a, b], "Fern, Monstera")).toEqual([
      { id: a, title: "Fern" },
      { id: b, title: "Monstera" },
    ]);
  });

  it("shows a missing target's id tail, never the UUID", () => {
    expect(relationChips([a, b], `Fern, ${b}`)).toEqual([
      { id: a, title: "Fern" },
      { id: b, title: "00000b" },
    ]);
    expect(relationChips([a], a)).toEqual([{ id: a, title: "00000a" }]);
  });

  it("falls back to id tails when a title contains the join separator", () => {
    const ids = [a, b];
    expect(relationChips(ids, "Window, kitchen, Monstera")).toEqual([
      { id: a, title: "00000a" },
      { id: b, title: "00000b" },
    ]);
  });

  it("has no chips for an empty relation", () => {
    expect(relationChips([], "")).toEqual([]);
  });

  it("writes a byte count in exact bytes then one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-4)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1434)).toBe("1.4 KiB");
    expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2 MiB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
  });

  it("labels an attachments list by its one file or its count", () => {
    const property = {
      key: "photos",
      name: "Photos",
      format: "attachments" as const,
    };
    expect(valueLabel("attachments", ["files/a/one.png"], property)).toBe("one.png");
    expect(
      valueLabel("attachments", ["files/a/one.png", "files/b/two.png"], property),
    ).toBe("2 files");
    expect(valueLabel("attachments", [], property)).toBe("");
  });
});
