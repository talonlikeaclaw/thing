import { describe, expect, it } from "vitest";

import {
  clampCell,
  normalizeRange,
  rangeCells,
  rangeContains,
  rangeSize,
  revealDelta,
  sameCell,
  stepCell,
  tabCell,
} from "@/lib/grid";

describe("sameCell", () => {
  it("compares both axes", () => {
    expect(sameCell({ row: 0, col: 0 }, { row: 0, col: 0 })).toBe(true);
    expect(sameCell({ row: 1, col: 0 }, { row: 0, col: 0 })).toBe(false);
    expect(sameCell({ row: 0, col: 1 }, { row: 0, col: 0 })).toBe(false);
  });

  it("treats two absent cells as equal", () => {
    expect(sameCell(null, null)).toBe(true);
    expect(sameCell(null, { row: 0, col: 0 })).toBe(false);
    expect(sameCell({ row: 0, col: 0 }, null)).toBe(false);
  });
});

describe("clampCell", () => {
  it("leaves a cell inside the grid alone", () => {
    expect(clampCell({ row: 2, col: 3 }, 5, 4)).toEqual({ row: 2, col: 3 });
  });

  it("saturates both axes", () => {
    expect(clampCell({ row: -3, col: -2 }, 5, 4)).toEqual({ row: 0, col: 0 });
    expect(clampCell({ row: 9, col: 7 }, 5, 4)).toEqual({ row: 4, col: 3 });
  });

  it("holds no position in a grid with no rows or no columns", () => {
    expect(clampCell({ row: 0, col: 0 }, 0, 4)).toBeNull();
    expect(clampCell({ row: 0, col: 0 }, 5, 0)).toBeNull();
  });
});

describe("stepCell", () => {
  it("steps within the grid", () => {
    expect(stepCell({ row: 1, col: 1 }, 1, 0, 3, 3)).toEqual({ row: 2, col: 1 });
    expect(stepCell({ row: 1, col: 1 }, 0, -1, 3, 3)).toEqual({ row: 1, col: 0 });
  });

  it("clamps at every edge instead of wrapping", () => {
    expect(stepCell({ row: 0, col: 0 }, -1, 0, 3, 3)).toEqual({ row: 0, col: 0 });
    expect(stepCell({ row: 0, col: 0 }, 0, -1, 3, 3)).toEqual({ row: 0, col: 0 });
    expect(stepCell({ row: 2, col: 2 }, 1, 1, 3, 3)).toEqual({ row: 2, col: 2 });
  });

  it("finds no cell in an empty grid", () => {
    expect(stepCell({ row: 0, col: 0 }, 1, 0, 0, 3)).toBeNull();
  });
});

describe("tabCell", () => {
  // Three data columns starting after one control column, two rows.
  const first = 1;
  const last = 3;

  it("moves to the next data cell forward", () => {
    expect(tabCell({ row: 0, col: first }, first, last, 2)).toEqual({ row: 0, col: 2 });
  });

  it("wraps to the next row's first data cell", () => {
    expect(tabCell({ row: 0, col: last }, first, last, 2)).toEqual({ row: 1, col: first });
  });

  it("leaves the grid at the last data cell", () => {
    expect(tabCell({ row: 1, col: last }, first, last, 2)).toBeNull();
  });

  it("walks backwards, wrapping to the previous row's last data cell", () => {
    expect(tabCell({ row: 0, col: 2 }, first, last, 2, true)).toEqual({
      row: 0,
      col: first,
    });
    expect(tabCell({ row: 1, col: first }, first, last, 2, true)).toEqual({
      row: 0,
      col: last,
    });
  });

  it("leaves the grid at the first data cell backwards", () => {
    expect(tabCell({ row: 0, col: first }, first, last, 2, true)).toBeNull();
  });

  it("enters the data grid from a control column at the nearest edge", () => {
    expect(tabCell({ row: 0, col: 0 }, first, last, 2)).toEqual({ row: 0, col: first });
    expect(tabCell({ row: 0, col: last + 1 }, first, last, 2, true)).toEqual({
      row: 0,
      col: last,
    });
    expect(tabCell({ row: 0, col: last + 1 }, first, last, 2)).toEqual({
      row: 1,
      col: first,
    });
  });

  it("holds a one-row grid to one pass", () => {
    expect(tabCell({ row: 0, col: first }, first, last, 1)).toEqual({ row: 0, col: 2 });
    expect(tabCell({ row: 0, col: last }, first, last, 1)).toBeNull();
    expect(tabCell({ row: 0, col: last }, first, last, 1, true)).toEqual({
      row: 0,
      col: 2,
    });
    expect(tabCell({ row: 0, col: first }, first, last, 1, true)).toBeNull();
  });

  it("clamps a row index past the grid before it steps", () => {
    expect(tabCell({ row: 7, col: last }, first, last, 2, true)).toEqual({
      row: 1,
      col: 2,
    });
    expect(tabCell({ row: 7, col: last }, first, last, 2)).toBeNull();
  });

  it("holds no cell when there are no rows or no data columns", () => {
    expect(tabCell({ row: 0, col: first }, first, last, 0)).toBeNull();
    expect(tabCell({ row: 0, col: first }, 2, 1, 3)).toBeNull();
  });
});

describe("revealDelta", () => {
  const port = { left: 300, right: 1100, top: 200, bottom: 700 };
  // The pinned title takes 200px on the left, the rail 140px on the right and
  // the sticky header 50px on top; a cell must clear all of them.
  const insets = { left: 200, top: 50, right: 140, bottom: 6 };

  it("holds still when the cell is inside the clear band", () => {
    expect(
      revealDelta({ left: 600, right: 700, top: 300, bottom: 340 }, port, insets),
    ).toEqual({ left: 0, top: 0 });
  });

  it("scrolls right when the cell hides under the pinned title", () => {
    expect(
      revealDelta({ left: 420, right: 520, top: 300, bottom: 340 }, port, insets),
    ).toEqual({ left: -80, top: 0 });
  });

  it("scrolls left when the cell hides under the action rail", () => {
    expect(
      revealDelta({ left: 900, right: 1000, top: 300, bottom: 340 }, port, insets),
    ).toEqual({ left: 40, top: 0 });
  });

  it("scrolls the cell out from under the sticky header", () => {
    expect(
      revealDelta({ left: 600, right: 700, top: 210, bottom: 250 }, port, insets),
    ).toEqual({ left: 0, top: -40 });
  });

  it("scrolls the cell up from the bottom edge", () => {
    expect(
      revealDelta({ left: 600, right: 700, top: 680, bottom: 720 }, port, insets),
    ).toEqual({ left: 0, top: 26 });
  });
});

describe("the range model", () => {
  it("normalises a rectangle from any two corners", () => {
    const expected = { top: 1, left: 2, bottom: 3, right: 4 };
    expect(normalizeRange({ row: 1, col: 2 }, { row: 3, col: 4 })).toEqual(expected);
    expect(normalizeRange({ row: 3, col: 4 }, { row: 1, col: 2 })).toEqual(expected);
    expect(normalizeRange({ row: 3, col: 2 }, { row: 1, col: 4 })).toEqual(expected);
  });

  it("contains its edges and nothing outside", () => {
    const range = normalizeRange({ row: 1, col: 1 }, { row: 2, col: 3 });
    expect(rangeContains(range, { row: 1, col: 1 })).toBe(true);
    expect(rangeContains(range, { row: 2, col: 3 })).toBe(true);
    expect(rangeContains(range, { row: 1, col: 3 })).toBe(true);
    expect(rangeContains(range, { row: 0, col: 2 })).toBe(false);
    expect(rangeContains(range, { row: 3, col: 2 })).toBe(false);
    expect(rangeContains(range, { row: 2, col: 0 })).toBe(false);
    expect(rangeContains(range, { row: 2, col: 4 })).toBe(false);
  });

  it("counts rows, columns and cells", () => {
    expect(rangeSize(normalizeRange({ row: 3, col: 4 }, { row: 5, col: 7 }))).toEqual({
      rows: 3,
      columns: 4,
      cells: 12,
    });
    expect(rangeSize(normalizeRange({ row: 2, col: 2 }, { row: 2, col: 2 }))).toEqual({
      rows: 1,
      columns: 1,
      cells: 1,
    });
  });

  it("lists its cells in row-major order", () => {
    expect(rangeCells(normalizeRange({ row: 0, col: 1 }, { row: 1, col: 2 }))).toEqual([
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ]);
  });
});
