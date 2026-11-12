import type { ObjectSummary, PropertyDisplay, PropertyFormat } from "@/api/types";
import { displayLabel } from "@/lib/presentation";

/** The only view column that is not a property; the server calls it `model::TITLE_KEY`. */
export const TITLE_COLUMN_KEY = "title";

/** One data column, in view order: the title first, then the view's properties. */
export interface GridColumn {
  /** `TITLE_COLUMN_KEY` or a property key. */
  key: string;
  /** The header's display text; the copy header and the footer sentence use it. */
  label: string;
  /** Absent for the title and for a view column whose property no longer exists. */
  format?: PropertyFormat;
  /** How the property's values read; absent means the server's label. */
  display?: PropertyDisplay;
}

/** A position in the data grid: row index and data-column index. */
export interface Cell {
  row: number;
  col: number;
}

/** An inclusive rectangle over data cells, already normalised. */
export interface Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** A rectangle in viewport pixels, as `getBoundingClientRect` reports it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How much of the scrollport a sticky column or header hides on each edge. */
export interface RevealInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The scroll the card must make to bring a cell out from under the sticky
 * title, rail and header. Zero on an axis already inside the safe band.
 */
export function revealDelta(
  cell: Box,
  port: Box,
  insets: RevealInsets,
): { left: number; top: number } {
  const safeLeft = port.left + insets.left;
  const safeRight = port.right - insets.right;
  const safeTop = port.top + insets.top;
  const safeBottom = port.bottom - insets.bottom;
  let left = 0;
  if (cell.left < safeLeft) {
    left = cell.left - safeLeft;
  } else if (cell.right > safeRight) {
    left = cell.right - safeRight;
  }
  let top = 0;
  if (cell.top < safeTop) {
    top = cell.top - safeTop;
  } else if (cell.bottom > safeBottom) {
    top = cell.bottom - safeBottom;
  }
  return { left, top };
}

/** Identity, null-safe: two absent cells are the same absent cell. */
export function sameCell(a: Cell | null, b: Cell | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.row === b.row && a.col === b.col;
}

/**
 * Saturates both axes into a grid. A grid with no rows or no columns has no
 * position to hold, so there is no cell.
 */
export function clampCell(
  cell: Cell,
  rowCount: number,
  columnCount: number,
): Cell | null {
  if (rowCount <= 0 || columnCount <= 0) {
    return null;
  }
  return {
    row: Math.min(Math.max(0, cell.row), rowCount - 1),
    col: Math.min(Math.max(0, cell.col), columnCount - 1),
  };
}

/** A step from a cell, clamped at every edge: movement never wraps. */
export function stepCell(
  cell: Cell,
  rowDelta: number,
  columnDelta: number,
  rowCount: number,
  columnCount: number,
): Cell | null {
  return clampCell(
    { row: cell.row + rowDelta, col: cell.col + columnDelta },
    rowCount,
    columnCount,
  );
}

/**
 * The next or previous data cell for Tab, wrapping by row. `null` at either
 * boundary means the caller must leave the key alone. A cell on a control
 * column enters the data grid at the nearest edge in the requested direction.
 */
export function tabCell(
  cell: Cell,
  firstDataCol: number,
  lastDataCol: number,
  rowCount: number,
  backwards = false,
): Cell | null {
  if (rowCount <= 0 || lastDataCol < firstDataCol) {
    return null;
  }
  const row = Math.min(Math.max(0, cell.row), rowCount - 1);
  if (backwards) {
    if (cell.col > lastDataCol) {
      return { row, col: lastDataCol };
    }
    if (cell.col > firstDataCol) {
      return { row, col: cell.col - 1 };
    }
    return row > 0 ? { row: row - 1, col: lastDataCol } : null;
  }
  if (cell.col < firstDataCol) {
    return { row, col: firstDataCol };
  }
  if (cell.col < lastDataCol) {
    return { row, col: cell.col + 1 };
  }
  return row < rowCount - 1 ? { row: row + 1, col: firstDataCol } : null;
}

/** The inclusive rectangle between two cells, in either order. */
export function normalizeRange(anchor: Cell, focus: Cell): Range {
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.col, focus.col),
  };
}

/** Inclusive containment: an edge cell is inside the rectangle. */
export function rangeContains(range: Range, cell: Cell): boolean {
  return (
    cell.row >= range.top &&
    cell.row <= range.bottom &&
    cell.col >= range.left &&
    cell.col <= range.right
  );
}

/** How many rows, columns and cells the rectangle covers. */
export function rangeSize(range: Range): {
  rows: number;
  columns: number;
  cells: number;
} {
  const rows = range.bottom - range.top + 1;
  const columns = range.right - range.left + 1;
  return { rows, columns, cells: rows * columns };
}

/**
 * A tab, CR or LF inside a TSV cell would invent a column or a row, so the
 * copy folds them into one space instead.
 */
function tsvText(text: string): string {
  return text.replace(/[\t\r\n]+/g, " ");
}

/**
 * A markdown cell escapes what would end the cell or the row, and keeps a
 * line break as an in-cell break; surrounding whitespace is trimmed.
 */
function markdownText(text: string): string {
  return text
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/** The displayed text of one data cell: the title, or the row's label for the key. */
export function cellText(column: GridColumn, row: ObjectSummary): string {
  if (column.key === TITLE_COLUMN_KEY) {
    return row.title;
  }
  const value = row.values[column.key];
  if (!value) {
    return "";
  }
  return displayLabel(column, value.value, value.label);
}

/** Header labels plus one text row per grid row, in view order. */
export function rangeMatrix(
  columns: readonly GridColumn[],
  rows: readonly ObjectSummary[],
  range: Range,
): { header: string[]; rows: string[][] } {
  const selected = columns.slice(range.left, range.right + 1);
  const header = selected.map((column) => column.label);
  const body: string[][] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const record = rows[row];
    body.push(record ? selected.map((column) => cellText(column, record)) : header.map(() => ""));
  }
  return { header, rows: body };
}

/** Header line, then one line per row: tabs between cells, newlines between rows. */
export function toTsv(header: readonly string[], rows: readonly string[][]): string {
  const lines = header.length > 0 ? [header] : [];
  return [...lines, ...rows]
    .map((cells) => cells.map(tsvText).join("\t"))
    .join("\n");
}

/** A markdown table: the header, a separator over its width, then one line per row. */
export function toMarkdown(header: readonly string[], rows: readonly string[][]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(markdownText).join(" | ")} |`;
  const separator = header.map(() => "---");
  return [line(header), line(separator), ...rows.map(line)].join("\n");
}

/** The rectangle's cells in row-major order. */
export function rangeCells(range: Range): Cell[] {
  const cells: Cell[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let col = range.left; col <= range.right; col += 1) {
      cells.push({ row, col });
    }
  }
  return cells;
}
