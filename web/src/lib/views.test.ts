import { describe, expect, it } from "vitest";

import type { ObjectSummary, PropertyDef, TypeDef, ViewDef } from "@/api/types";
import {
  addMonths,
  clampWidth,
  defaultWidth,
  effectiveQuery,
  groupByDate,
  groupRows,
  monthGrid,
  monthOf,
  movedViewSlot,
  moveViewColumn,
  queryIsDirty,
  recordsByDate,
  selectedView,
  withColumn,
  withWidth,
  withoutColumn,
  withoutPage,
} from "@/lib/views";

const table: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [{ property: "title", direction: "asc", empty: "end" }],
  filter: { op: "and", conditions: [] },
  columns: ["title", "room", "due_date"],
  widths: { title: 280, room: 120 },
};

const board: ViewDef = {
  key: "by_room",
  name: "By room",
  kind: "board",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title"],
  group_by: "room",
};

const type: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: [{ key: "room", required: false, featured: false }],
  views: [table, board],
  default_view: "all",
};

const room: PropertyDef = {
  key: "room",
  name: "Room",
  format: "select",
  options: [
    { key: "kitchen", name: "Kitchen", color: "#c8d96b" },
    { key: "balcony", name: "Balcony", color: "#f08a72" },
  ],
};

function row(
  id: string,
  value: unknown,
  label = String(value ?? ""),
): ObjectSummary {
  return {
    id,
    type: "plant",
    title: id,
    rev: 1,
    updated_at: "2026-10-22T00:00:00Z",
    values: value === undefined ? {} : { room: { value, label } },
    missing_relations: [],
  };
}

describe("view selection", () => {
  it("uses the default view when the URL names none", () => {
    expect(selectedView(type)).toEqual({ view: table, unknown: false });
  });

  it("uses the named view and flags only a key that is gone", () => {
    expect(selectedView(type, "by_room")).toEqual({ view: board, unknown: false });
    expect(selectedView(type, "deleted")).toEqual({ view: table, unknown: true });
  });
});

describe("effective query", () => {
  it("falls back to the saved view", () => {
    expect(effectiveQuery(table, new URLSearchParams())).toEqual({
      filter: table.filter,
      sorts: table.sorts,
    });
  });

  it("lets the URL override a saved filter and sort", () => {
    const params = new URLSearchParams({
      filter: JSON.stringify({ op: "or", conditions: [] }),
      sorts: JSON.stringify([{ property: "room", direction: "desc" }]),
    });
    expect(effectiveQuery(table, params)).toEqual({
      filter: { op: "or", conditions: [] },
      sorts: [{ property: "room", direction: "desc", empty: "end" }],
    });
  });

  it("is dirty only when the query differs from the saved view", () => {
    expect(queryIsDirty(table, table.filter, table.sorts)).toBe(false);
    expect(
      queryIsDirty(table, table.filter, [{ property: "title", direction: "asc" }]),
    ).toBe(false);
    expect(
      queryIsDirty(table, table.filter, [{ property: "title", direction: "desc" }]),
    ).toBe(true);
    expect(
      queryIsDirty(
        table,
        { op: "and", conditions: [{ property: "room", condition: "is_empty" }] },
        table.sorts,
      ),
    ).toBe(true);
  });
});

describe("paging params", () => {
  it("drops the page while keeping every other parameter", () => {
    const params = new URLSearchParams({ view: "all", page: "3", q: "fern" });
    const next = withoutPage(params);
    expect(next.get("page")).toBeNull();
    expect(next.get("view")).toBe("all");
    expect(next.get("q")).toBe("fern");
    expect(params.get("page")).toBe("3");
  });
});

describe("table widths", () => {
  it("uses saved widths and renderer defaults", () => {
    expect(defaultWidth(table, "title")).toBe(280);
    expect(defaultWidth(table, "room")).toBe(120);
    expect(defaultWidth(board, "title")).toBe(240);
    expect(defaultWidth(board, "room")).toBe(140);
  });

  it("clamps widths to the allowed range", () => {
    expect(clampWidth(79)).toBe(80);
    expect(clampWidth(801)).toBe(800);
    expect(clampWidth(240.4)).toBe(240);
  });

  it("sets a width without losing the others", () => {
    expect(withWidth(table, "room", 500)).toEqual({
      columns: ["title", "room", "due_date"],
      widths: { title: 280, room: 500 },
    });
  });
});

describe("column layout", () => {
  it("keeps title first and prunes a hidden column's width", () => {
    expect(withoutColumn(table, "room")).toEqual({
      columns: ["title", "due_date"],
      widths: { title: 280 },
    });
    expect(withoutColumn(table, "title")).toEqual({
      columns: ["title", "room", "due_date"],
      widths: { title: 280, room: 120 },
    });
  });

  it("shows a column once and hides it again", () => {
    const hidden = withoutColumn(table, "room");
    expect(withColumn({ ...table, ...hidden }, "room", true)).toEqual({
      columns: ["title", "due_date", "room"],
      widths: { title: 280 },
    });
    expect(withColumn(table, "room", true).columns).toEqual([
      "title",
      "due_date",
      "room",
    ]);
    expect(withColumn(table, "room", false).columns).toEqual(["title", "due_date"]);
  });

  it("moves a column after title but never moves title", () => {
    expect(moveViewColumn(table, "due_date", -1)).toEqual([
      "title",
      "due_date",
      "room",
    ]);
    expect(moveViewColumn(table, "room", -1)).toEqual(table.columns);
    expect(moveViewColumn(table, "title", 1)).toEqual(table.columns);
  });
});

describe("view order", () => {
  it("names the slot a view moves to, or nothing at an end", () => {
    const views = [{ key: "all" }, { key: "by_room" }, { key: "gallery" }];
    expect(movedViewSlot(views, "gallery", -1)).toBe(1);
    expect(movedViewSlot(views, "gallery", -2)).toBe(0);
    expect(movedViewSlot(views, "all", 1)).toBe(1);
    expect(movedViewSlot(views, "all", -1)).toBeNull();
    expect(movedViewSlot(views, "gallery", 1)).toBeNull();
    expect(movedViewSlot(views, "gallery", 5)).toBeNull();
    expect(movedViewSlot(views, "gone", 1)).toBeNull();
    expect(movedViewSlot([{ key: "only" }], "only", 1)).toBeNull();
    // The default owns slot 0, so every other view stops at 1.
    expect(movedViewSlot(views, "by_room", -1, 1)).toBeNull();
    expect(movedViewSlot(views, "gallery", -1, 1)).toBe(1);
    expect(movedViewSlot(views, "gallery", -2, 1)).toBeNull();
  });
});

describe("board grouping", () => {
  it("orders lanes by option, then unknown keys, then no value", () => {
    const lanes = groupRows(
      [
        row("a", "kitchen"),
        row("b", "garage", "Garage"),
        row("c", undefined),
        row("d", "balcony"),
        row("e", "attic", "Attic"),
      ],
      room,
    );
    expect(lanes.map((lane) => [lane.key, lane.label, lane.rows.length])).toEqual([
      ["kitchen", "Kitchen", 1],
      ["balcony", "Balcony", 1],
      ["attic", "Attic", 1],
      ["garage", "Garage", 1],
      ["", "No value", 1],
    ]);
    expect(lanes.at(-1)?.noValue).toBe(true);
  });

  it("keeps every option lane and omits no-value when every row has one", () => {
    const lanes = groupRows([row("a", "kitchen")], room);
    expect(lanes.map((lane) => [lane.key, lane.rows.length, lane.noValue])).toEqual([
      ["kitchen", 1, false],
      ["balcony", 0, false],
    ]);
  });
});

describe("calendar dates", () => {
  it("groups generic items by their date, preserving input order", () => {
    const items = [
      { id: "a", day: "2026-10-22" },
      { id: "b", day: "2026-10-23" },
      { id: "c", day: "2026-10-22" },
      { id: "d", day: "" },
    ];
    const byDate = groupByDate(items, (item) => item.day);
    expect([...byDate.keys()]).toEqual(["2026-10-22", "2026-10-23"]);
    expect(byDate.get("2026-10-22")?.map((item) => item.id)).toEqual(["a", "c"]);
    expect(byDate.get("2026-10-23")?.map((item) => item.id)).toEqual(["b"]);
  });

  it("groups rows by their raw date and skips empty or malformed values", () => {
    const dated = (id: string, value: string) => ({
      ...row(id, undefined),
      values: { due_date: { value, label: value } },
    });
    const rows = [
      dated("a", "2026-10-22"),
      dated("b", "2026-10-22"),
      row("c", undefined),
      dated("d", "tomorrow"),
    ];
    const byDate = recordsByDate(rows, "due_date");
    expect([...byDate.keys()]).toEqual(["2026-10-22"]);
    expect(byDate.get("2026-10-22")?.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("builds a Monday-first grid that includes adjacent days", () => {
    const weeks = monthGrid(2026, 10);
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.map((cell) => [cell.date, cell.inMonth])).toEqual([
      ["2026-09-28", false],
      ["2026-09-29", false],
      ["2026-09-30", false],
      ["2026-10-01", true],
      ["2026-10-02", true],
      ["2026-10-03", true],
      ["2026-10-04", true],
    ]);
    expect(weeks.at(-1)?.at(-1)).toEqual({ date: "2026-11-01", inMonth: false });
  });

  it("moves months in UTC across year boundaries", () => {
    expect(monthOf("2026-10-22")).toBe("2026-10");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", 2)).toBe("2026-12");
  });
});
