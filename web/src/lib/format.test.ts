import { describe, expect, it } from "vitest";

import type { PropertyDef } from "@/api/types";
import {
  datetimeLocal,
  fromDatetimeLocal,
  isBlank,
  optionName,
  parseCellText,
  valueLabel,
} from "@/lib/format";

const status: PropertyDef = {
  key: "status",
  name: "Status",
  format: "select",
  options: [{ key: "todo", name: "To do", color: "#c8d96b" }],
};

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
