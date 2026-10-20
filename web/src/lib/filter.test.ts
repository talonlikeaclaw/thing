import { describe, expect, it } from "vitest";

import type { TypeDef } from "@/api/types";
import {
  addSort,
  effectiveView,
  filterFromParams,
  filterParam,
  moveSort,
  newCondition,
  operatorsFor,
  parseConditionText,
  sortsFromParams,
  sortsParam,
  withConditionOp,
  withConditionValue,
  withParam,
} from "@/lib/filter";

const type: TypeDef = {
  key: "chore",
  name: "Chore",
  name_plural: "Chores",
  description: "",
  properties: [{ key: "status", required: false, featured: true }],
  view: {
    sorts: [{ property: "title", direction: "asc", empty: "end" }],
    filter: { op: "and", conditions: [] },
    columns: ["title", "status"],
  },
};

describe("filter parameters", () => {
  it("round-trips a filter through the URL", () => {
    const filter = {
      op: "or" as const,
      conditions: [newCondition({ key: "title", label: "Title", format: "text" })],
    };
    const encoded = filterParam(filter);
    expect(encoded).not.toBeNull();
    expect(filterFromParams(new URLSearchParams({ filter: encoded ?? "" }))).toEqual(filter);
  });

  it("ignores malformed JSON and keeps an explicitly empty filter", () => {
    expect(filterFromParams(new URLSearchParams({ filter: "{not json" }))).toBeUndefined();
    expect(filterFromParams(new URLSearchParams())).toBeUndefined();
    expect(filterFromParams(new URLSearchParams({ filter: filterParam({ op: "and", conditions: [] }) }))).toEqual(
      { op: "and", conditions: [] },
    );
  });

  it("drops a value when the operator cannot carry one", () => {
    const condition = { property: "title", condition: "contains" as const, value: "fern" };
    expect(withConditionOp(condition, "is_empty")).toEqual({
      property: "title",
      condition: "is_empty",
    });
    expect(withConditionValue(condition, "")).toEqual({
      property: "title",
      condition: "contains",
    });
  });
});

describe("sort parameters", () => {
  it("round-trips sorts and keeps the default empty placement", () => {
    const sorts = [{ property: "status", direction: "desc" as const, empty: "start" as const }];
    const encoded = sortsParam(sorts);
    expect(sortsFromParams(new URLSearchParams({ sorts: encoded ?? "" }))).toEqual(sorts);
    expect(sortsFromParams(new URLSearchParams({ sorts: sortsParam([]) }))).toEqual([]);
  });

  it("appends one sort per property and reorders without losing the rest", () => {
    const sorts = addSort([{ property: "title", direction: "asc" }], "status");
    expect(sorts.map((sort) => sort.property)).toEqual(["title", "status"]);
    expect(addSort(sorts, "status")).toBe(sorts);
    expect(moveSort(sorts, "status", -1).map((sort) => sort.property)).toEqual([
      "status",
      "title",
    ]);
    expect(moveSort(sorts, "title", -1)).toBe(sorts);
  });
});

describe("effective view", () => {
  it("falls back to the type's saved view and reads search text", () => {
    const params = new URLSearchParams({ q: " fern " });
    expect(effectiveView(type, params)).toEqual({
      filter: type.view.filter,
      sorts: type.view.sorts,
      q: "fern",
    });
  });

  it("lets the URL override a saved sort", () => {
    const params = new URLSearchParams({
      sorts: JSON.stringify([{ property: "status", direction: "desc" }]),
    });
    expect(effectiveView(type, params).sorts).toEqual([
      { property: "status", direction: "desc", empty: "end" },
    ]);
  });

  it("writes and clears a parameter without disturbing the others", () => {
    const params = new URLSearchParams({ type: "chore" });
    const withQuery = withParam(params, "q", "fern");
    expect(withQuery.get("q")).toBe("fern");
    expect(withParam(withQuery, "q", "").has("q")).toBe(false);
    expect(withQuery.get("type")).toBe("chore");
  });
});

describe("condition values", () => {
  it("parses numbers, dates and checkboxes and refuses malformed input", () => {
    expect(parseConditionText("greater", "number", "12")).toBe(12);
    expect(parseConditionText("greater", "number", "twelve")).toBeUndefined();
    expect(parseConditionText("equal", "date", "2026-10-20")).toBe("2026-10-20");
    expect(parseConditionText("equal", "date", "20/10/2026")).toBeUndefined();
    expect(parseConditionText("equal", "checkbox", "true")).toBe(true);
    expect(parseConditionText("equal", "checkbox", "yes")).toBeUndefined();
  });

  it("offers only operators the filter bar can render a value for", () => {
    expect(operatorsFor("multi_select")).toEqual([
      "contains",
      "not_contains",
      "is_empty",
      "is_not_empty",
    ]);
    expect(operatorsFor("select")).toContain("equal");
    expect(operatorsFor("select")).not.toContain("in");
  });
});
