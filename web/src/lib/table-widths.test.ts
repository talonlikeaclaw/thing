import { describe, expect, it } from "vitest";

import type { ViewDef } from "@/api/types";
import {
  COMPACT_COLUMN_WIDTH,
  COMPACT_TITLE_WIDTH,
  DRAG_THRESHOLD,
  dragDelta,
  dragMoved,
  dragWidth,
  savedWidth,
  savedWidths,
  widthPlan,
} from "@/lib/table-widths";

const table: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title", "room", "due_date"],
  widths: { title: 280, room: 120 },
};

/** Selection (44) + action rail and its spacer (134 twice). */
const FIXED = 44 + 134 * 2;

describe("saved widths", () => {
  it("paints the saved width, clamped, and defaults the rest", () => {
    expect(savedWidth(table, "title")).toBe(280);
    expect(savedWidth(table, "room")).toBe(120);
    expect(savedWidth(table, "due_date")).toBe(140);
    expect(savedWidth({ ...table, widths: { title: 60 } }, "title")).toBe(80);
    expect(savedWidth({ ...table, widths: { title: 900 } }, "title")).toBe(800);
  });

  it("keeps the render order of its keys", () => {
    expect(Object.keys(savedWidths(table, ["title", "due_date", "room"]))).toEqual([
      "title",
      "due_date",
      "room",
    ]);
  });

  it("paints phone widths whatever the view saved", () => {
    const phone = savedWidths(table, ["title", "room", "due_date"], true);
    expect(phone).toEqual({
      title: COMPACT_TITLE_WIDTH,
      room: COMPACT_COLUMN_WIDTH,
      due_date: COMPACT_COLUMN_WIDTH,
    });
    expect(savedWidths(table, ["title", "room", "due_date"], true)).toEqual({
      title: COMPACT_TITLE_WIDTH,
      room: COMPACT_COLUMN_WIDTH,
      due_date: COMPACT_COLUMN_WIDTH,
    });
  });
});

describe("width plan", () => {
  const widths = savedWidths(table, ["title", "room", "due_date"]);

  it("fills a wide window exactly with a filler column", () => {
    const plan = widthPlan(widths, 1000, FIXED);
    expect(plan.widths).toEqual(widths);
    expect(plan.filler).toBe(1000 - FIXED - 540);
    expect(plan.tableWidth).toBe(1000);
  });

  it("stops filling and scrolls when the columns exceed the port", () => {
    const plan = widthPlan(widths, 300, FIXED);
    expect(plan.filler).toBe(0);
    expect(plan.tableWidth).toBe(FIXED + 540);
  });

  it("moves only the dragged column and the filler", () => {
    const before = widthPlan(widths, 1000, FIXED);
    const after = widthPlan({ ...widths, room: 240 }, 1000, FIXED);
    expect(after.widths.title).toBe(before.widths.title);
    expect(after.widths.due_date).toBe(before.widths.due_date);
    expect(after.filler).toBe(before.filler - 120);
    expect(after.tableWidth).toBe(before.tableWidth);
  });
});

describe("drag", () => {
  it("ignores travel below the threshold", () => {
    expect(dragMoved(300, 300 + DRAG_THRESHOLD - 1)).toBe(false);
    expect(dragMoved(300, 300 - DRAG_THRESHOLD)).toBe(true);
  });

  it("adds exactly the distance dragged", () => {
    expect(dragDelta(300, 400)).toBe(100);
    expect(dragWidth(120, 300, 400)).toBe(220);
    expect(dragWidth(120, 400, 300)).toBe(80);
  });

  it("clamps at both ends", () => {
    expect(dragWidth(120, 300, 300 + 2000)).toBe(800);
    expect(dragWidth(120, 300, 300 - 2000)).toBe(80);
  });
});
