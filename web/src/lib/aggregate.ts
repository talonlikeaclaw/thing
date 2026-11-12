import type { ObjectSummary, PropertyFormat } from "@/api/types";
import { formatDateTime, formatDay } from "@/lib/display";
import { plural } from "@/lib/format";
import { TITLE_COLUMN_KEY, type GridColumn } from "@/lib/grid";

/** One data column's footer: a short line for the cell, a sentence for the reader. */
export interface ColumnSummary {
  /** The one-line footer text, e.g. "Σ 1,204 · avg 24.08", "9 distinct", "—". */
  short: string;
  /** The full sentence the cell's aria-label carries. */
  long: string;
  /** Filled cells, and the rows the summary covers. */
  filled: number;
  total: number;
}

/** Numbers read in the reader's locale, at most two fraction digits. */
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/** A civil day's month and day only, held in UTC so the day never shifts. */
const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** The formats whose footer counts filled cells rather than listing values. */
const COUNTED_FORMATS: Partial<Record<PropertyFormat, true>> = {
  relation: true,
  attachments: true,
  recurrence: true,
  file: true,
  image: true,
};

function shortDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? day : dayFormat.format(at);
}

function shortInstant(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(at);
}

function emptySummary(column: GridColumn, total: number): ColumnSummary {
  return {
    short: "—",
    long: `${column.label}: none of the ${total} rows have a value`,
    filled: 0,
    total,
  };
}

function summarizeNumbers(
  column: GridColumn,
  values: readonly (ObjectSummary["values"][string] | undefined)[],
  total: number,
): ColumnSummary {
  const numbers = values
    .map((value) => value?.value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) {
    return emptySummary(column, total);
  }
  const sum = numbers.reduce((running, value) => running + value, 0);
  const average = sum / numbers.length;
  const lowest = Math.min(...numbers);
  const highest = Math.max(...numbers);
  const sumText = numberFormat.format(sum);
  const averageText = numberFormat.format(average);
  return {
    short: `Σ ${sumText} · avg ${averageText}`,
    long: `${column.label}: ${numbers.length} of ${total} filled; sum ${sumText}; average ${averageText}; lowest ${numberFormat.format(lowest)}; highest ${numberFormat.format(highest)}`,
    filled: numbers.length,
    total,
  };
}

function summarizeCheckboxes(
  column: GridColumn,
  values: readonly (ObjectSummary["values"][string] | undefined)[],
  total: number,
): ColumnSummary {
  const booleans = values
    .map((value) => value?.value)
    .filter((value): value is boolean => typeof value === "boolean");
  if (booleans.length === 0) {
    return emptySummary(column, total);
  }
  const checked = booleans.filter(Boolean).length;
  return {
    short: `${checked} of ${booleans.length} checked`,
    long: `${column.label}: ${booleans.length} of ${total} filled; ${checked} checked`,
    filled: booleans.length,
    total,
  };
}

/** A date or a datetime: its stored stamp sorts lexicographically into earliest and latest. */
function summarizeStamps(
  column: GridColumn,
  values: readonly (ObjectSummary["values"][string] | undefined)[],
  total: number,
  short: (stamp: string) => string,
  long: (stamp: string) => string,
): ColumnSummary {
  const stamps = values
    .filter((value) => (value?.label ?? "") !== "")
    .map((value) => String(value?.value ?? ""))
    .sort();
  const earliest = stamps[0];
  const latest = stamps[stamps.length - 1];
  if (earliest === undefined || latest === undefined) {
    return emptySummary(column, total);
  }
  return {
    short: `${short(earliest)} – ${short(latest)}`,
    long: `${column.label}: ${stamps.length} of ${total} filled; earliest ${long(earliest)}; latest ${long(latest)}`,
    filled: stamps.length,
    total,
  };
}

function summarizeFilled(
  column: GridColumn,
  values: readonly (ObjectSummary["values"][string] | undefined)[],
  total: number,
): ColumnSummary {
  const filled = values.filter((value) => (value?.label ?? "") !== "").length;
  if (filled === 0) {
    return emptySummary(column, total);
  }
  return {
    short: `${filled} filled`,
    long: `${column.label}: ${filled} of ${total} filled`,
    filled,
    total,
  };
}

function summarizeDistinct(
  column: GridColumn,
  values: readonly (ObjectSummary["values"][string] | undefined)[],
  total: number,
): ColumnSummary {
  const labels = values
    .map((value) => value?.label ?? "")
    .filter((label) => label !== "");
  if (labels.length === 0) {
    return emptySummary(column, total);
  }
  const distinct = new Set(labels).size;
  return {
    short: `${distinct} distinct`,
    long: `${column.label}: ${labels.length} of ${total} filled; ${plural(distinct, "distinct value", "distinct values")}`,
    filled: labels.length,
    total,
  };
}

/**
 * The footer's reading of one column over the rows the table shows. A
 * calculated column is summarised by its result format, exactly like a stored
 * one: the label the row already carries is the value.
 */
export function summarizeColumn(
  column: GridColumn,
  rows: readonly ObjectSummary[],
  timeZone: string,
): ColumnSummary {
  const total = rows.length;
  if (column.key === TITLE_COLUMN_KEY) {
    const counted = plural(total, "row");
    return {
      short: counted,
      long: `${column.label}: ${counted}`,
      filled: total,
      total,
    };
  }
  const values = rows.map((row) => row.values[column.key]);
  if (column.format === "number") {
    return summarizeNumbers(column, values, total);
  }
  if (column.format === "checkbox") {
    return summarizeCheckboxes(column, values, total);
  }
  if (column.format === "date") {
    return summarizeStamps(column, values, total, shortDay, formatDay);
  }
  if (column.format === "datetime") {
    return summarizeStamps(
      column,
      values,
      total,
      (stamp) => shortInstant(stamp, timeZone),
      (stamp) => formatDateTime(stamp, timeZone),
    );
  }
  if (column.format && COUNTED_FORMATS[column.format]) {
    return summarizeFilled(column, values, total);
  }
  return summarizeDistinct(column, values, total);
}
