import { describe, expect, it } from "vitest";

import type { TypeDef } from "@/api/types";
import {
  addSort,
  columnChoices,
  completeFilter,
  conditionChipLabel,
  conditionIsComplete,
  conditionKey,
  cycleSort,
  datePresets,
  filterChoices,
  hasConditions,
  filterFromParams,
  filterParam,
  moveSort,
  newCondition,
  operatorsFor,
  parseConditionText,
  quickFilters,
  shiftDay,
  sortsFromParams,
  sortsParam,
  withConditionOp,
  withConditionValue,
  withConditions,
  withParam,
  withoutConditions,
} from "@/lib/filter";

const type: TypeDef = {
  key: "chore",
  name: "Chore",
  name_plural: "Chores",
  description: "",
  schedule: false,
  properties: [{ key: "status", required: false, featured: true }],
  views: [
    {
      key: "all",
      name: "All",
      kind: "table",
      sorts: [{ property: "title", direction: "asc", empty: "end" }],
      filter: { op: "and", conditions: [] },
      columns: ["title", "status"],
    },
  ],
  default_view: "all",
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

describe("url parameters", () => {
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
    // A relation's value editor is a target list, so several targets are one
    // condition rather than an impossible one.
    expect(operatorsFor("relation")).toEqual([
      "equal",
      "not_equal",
      "in",
      "not_in",
      "is_empty",
      "is_not_empty",
    ]);
    expect(operatorsFor("recurrence")).toEqual([
      "equal",
      "not_equal",
      "is_empty",
      "is_not_empty",
    ]);
    // A rollup's list is display text: it filters by substring or emptiness.
    expect(operatorsFor("list")).toEqual([
      "contains",
      "not_contains",
      "is_empty",
      "is_not_empty",
    ]);
  });

  it("filters and sorts a calculated column by its own key", () => {
    const garden: TypeDef = {
      ...type,
      properties: [
        { key: "room", required: false, featured: false },
        { key: "room_titles", required: false, featured: false },
      ],
    };
    const computed = [
      { key: "room", name: "Room", format: "select" as const },
      {
        key: "room_titles",
        name: "Room titles",
        format: "list" as const,
        compute: { kind: "rollup" as const, relation: "room", aggregate: "list" as const },
      },
    ];
    // The column carries its own key, which is what a filter or sort sends.
    expect(filterChoices(garden, computed)).toContainEqual({
      key: "room_titles",
      label: "Room titles",
      format: "list",
    });
    expect(columnChoices(garden, computed)).toContainEqual({
      key: "room_titles",
      label: "Room titles",
      format: "list",
    });
  });

  it("offers generated schedule members as filter columns", () => {
    const scheduled: TypeDef = {
      ...type,
      schedule: true,
      implicit_properties: [
        { key: "due_date", name: "Due", format: "date" },
        { key: "recurrence", name: "Repeats", format: "recurrence" },
        { key: "last_completed_at", name: "Last completed", format: "datetime" },
      ],
    };
    const choices = columnChoices(scheduled, [
      { key: "status", name: "Status", format: "text" },
      ...(scheduled.implicit_properties ?? []),
    ]);
    expect(choices.map((choice) => choice.key)).toEqual([
      "title",
      "status",
      "due_date",
      "recurrence",
      "last_completed_at",
      "updated_at",
    ]);
  });
});

describe("filter drafts", () => {
  it("keeps a condition out of the query until it has a value", () => {
    const draft = newCondition({ key: "title", label: "Title", format: "text" });
    expect(draft.value).toBeUndefined();
    expect(conditionIsComplete(draft)).toBe(false);
    expect(completeFilter({ op: "and", conditions: [draft] })).toEqual({
      op: "and",
      conditions: [],
    });

    const filled = withConditionValue(draft, "fern");
    expect(conditionIsComplete(filled)).toBe(true);
    expect(completeFilter({ op: "and", conditions: [draft, filled] }).conditions).toEqual([
      filled,
    ]);
  });

  it("treats value-less operators and empty lists as complete or incomplete", () => {
    expect(conditionIsComplete({ property: "title", condition: "is_empty" })).toBe(true);
    expect(conditionIsComplete({ property: "title", condition: "equal", value: [] })).toBe(false);
    expect(conditionIsComplete({ property: "title", condition: "equal", value: "" })).toBe(false);
    expect(conditionIsComplete({ property: "title", condition: "equal", value: "0" })).toBe(true);
  });
});

describe("header sorting", () => {
  it("cycles one column through ascending, descending and off", () => {
    const ascending = cycleSort([], "status", false);
    expect(ascending).toEqual([{ property: "status", direction: "asc" }]);
    const descending = cycleSort(ascending, "status", false);
    expect(descending).toEqual([{ property: "status", direction: "desc" }]);
    expect(cycleSort(descending, "status", false)).toEqual([]);
  });

  it("keeps other columns only when Shift is held", () => {
    const base = [{ property: "title", direction: "asc" as const }];
    expect(cycleSort(base, "status", false).map((sort) => sort.property)).toEqual(["status"]);
    expect(cycleSort(base, "status", true).map((sort) => sort.property)).toEqual([
      "title",
      "status",
    ]);
    const both = cycleSort(base, "status", true);
    expect(cycleSort(both, "status", true)[1]?.direction).toBe("desc");
    expect(cycleSort(cycleSort(both, "status", true), "status", true)).toEqual(base);
  });
});

describe("day arithmetic and presets", () => {
  it("shifts a calendar day across a month and a year", () => {
    expect(shiftDay("2026-11-08", 1)).toBe("2026-11-09");
    expect(shiftDay("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-11-08", 0)).toBe("2026-11-08");
  });

  it("asks the schedule's questions as due_date conditions in the space zone", () => {
    const shorts = quickFilters("2026-11-08");
    expect(shorts.map((short) => short.label)).toEqual([
      "Overdue",
      "Due today",
      "Next 7 days",
      "No due date",
    ]);
    expect(shorts[0]?.conditions).toEqual([
      { property: "due_date", condition: "less", value: "2026-11-08" },
    ]);
    expect(shorts[2]?.conditions).toEqual([
      { property: "due_date", condition: "greater_or_equal", value: "2026-11-08" },
      { property: "due_date", condition: "less_or_equal", value: "2026-11-14" },
    ]);
    expect(shorts[3]?.conditions).toEqual([
      { property: "due_date", condition: "is_empty" },
    ]);
  });

  it("writes date presets as whole days, a range as two conditions", () => {
    const presets = datePresets("2026-11-08", "date", "due_date");
    expect(presets.map((preset) => preset.label)).toEqual([
      "Today",
      "Yesterday",
      "Tomorrow",
      "This week",
      "Next 7 days",
      "No date",
    ]);
    expect(presets[1]?.conditions).toEqual([
      { property: "due_date", condition: "equal", value: "2026-11-07" },
    ]);
    // 2026-11-08 is a Sunday, so the Monday-first week is the 2nd to the 8th.
    expect(presets[3]?.conditions).toEqual([
      { property: "due_date", condition: "greater_or_equal", value: "2026-11-02" },
      { property: "due_date", condition: "less_or_equal", value: "2026-11-08" },
    ]);
    expect(presets[5]?.conditions).toEqual([
      { property: "due_date", condition: "is_empty" },
    ]);
  });

  it("starts a datetime preset at midnight so it still parses", () => {
    const today = datePresets("2026-11-08", "datetime", "created").find(
      (preset) => preset.key === "today",
    );
    expect(today?.conditions[0]?.value).toBe("2026-11-08T00:00:00Z");
  });
});

describe("preset membership", () => {
  const overdue = quickFilters("2026-11-08")[0]?.conditions ?? [];

  it("adds a shortcut once and removes exactly what it wrote", () => {
    const empty = { op: "and" as const, conditions: [] };
    const added = withConditions(empty, overdue);
    expect(hasConditions(added, overdue)).toBe(true);
    expect(withConditions(added, overdue)).toEqual(added);
    expect(withoutConditions(added, overdue).conditions).toEqual([]);
    expect(hasConditions(empty, overdue)).toBe(false);
  });

  it("tells two conditions on one column apart by their value", () => {
    const other = [{ property: "due_date", condition: "less" as const, value: "2026-11-01" }];
    expect(conditionKey(overdue[0]!)).not.toBe(conditionKey(other[0]!));
    const filter = withConditions({ op: "and", conditions: [] }, overdue);
    expect(withoutConditions(filter, other).conditions).toEqual(overdue);
  });

  it("words a chip as the column, the operator and the value", () => {
    const columns = columnChoices(type, [
      { key: "status", name: "Status", format: "select" },
    ]);
    expect(
      conditionChipLabel(columns[1], { property: "status", condition: "equal", value: "done" }, "Done"),
    ).toBe("Status is Done");
    expect(
      conditionChipLabel(columns[1], { property: "status", condition: "is_empty" }, ""),
    ).toBe("Status is empty");
  });
});

describe("filter columns", () => {
  it("names only what a condition may carry, never the sort-only column", () => {
    const scheduled: TypeDef = {
      ...type,
      schedule: true,
      implicit_properties: [{ key: "due_date", name: "Due", format: "date" }],
    };
    const columns = filterChoices(scheduled, [
      { key: "status", name: "Status", format: "select" },
      { key: "due_date", name: "Due", format: "date" },
    ]);
    expect(columns.map((column) => column.key)).toEqual(["title", "status", "due_date"]);
    expect(columnChoices(scheduled, [])).toContainEqual({
      key: "updated_at",
      label: "Updated",
      format: "datetime",
    });
  });
});
