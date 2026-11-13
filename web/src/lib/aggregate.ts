import type { ObjectSummary, PropertyFormat, SummaryKind } from "@/api/types";
import { formatDateTime, formatDay } from "@/lib/display";
import { plural } from "@/lib/format";
import { TITLE_COLUMN_KEY, type GridColumn } from "@/lib/grid";
import { numberText } from "@/lib/presentation";

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
  // The display's grammar where it has one, the 0.8.1 reading where it does not.
  const text = (number: number) => numberText(number, column.display) ?? numberFormat.format(number);
  const sum = numbers.reduce((running, value) => running + value, 0);
  const average = sum / numbers.length;
  const lowest = Math.min(...numbers);
  const highest = Math.max(...numbers);
  const filled = `${numbers.length} of ${total} filled`;
  const sumText = text(sum);
  const averageText = text(average);
  const lowestText = text(lowest);
  const highestText = text(highest);
  switch (column.summary) {
    case "sum":
      return { short: `Σ ${sumText}`, long: `${column.label}: ${filled}; sum ${sumText}`, filled: numbers.length, total };
    case "average":
      return { short: `avg ${averageText}`, long: `${column.label}: ${filled}; average ${averageText}`, filled: numbers.length, total };
    case "lowest":
      return { short: `low ${lowestText}`, long: `${column.label}: ${filled}; lowest ${lowestText}`, filled: numbers.length, total };
    case "highest":
      return { short: `high ${highestText}`, long: `${column.label}: ${filled}; highest ${highestText}`, filled: numbers.length, total };
    case "filled":
      return { short: filled, long: `${column.label}: ${filled}`, filled: numbers.length, total };
    default:
      return {
        short: `Σ ${sumText} · avg ${averageText}`,
        long: `${column.label}: ${filled}; sum ${sumText}; average ${averageText}; lowest ${lowestText}; highest ${highestText}`,
        filled: numbers.length,
        total,
      };
  }
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
  if (column.summary === "filled") {
    return {
      short: `${booleans.length} filled`,
      long: `${column.label}: ${booleans.length} of ${total} filled`,
      filled: booleans.length,
      total,
    };
  }
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
  const filled = `${stamps.length} of ${total} filled`;
  if (column.summary === "earliest") {
    return {
      short: short(earliest),
      long: `${column.label}: ${filled}; earliest ${long(earliest)}`,
      filled: stamps.length,
      total,
    };
  }
  if (column.summary === "latest") {
    return {
      short: short(latest),
      long: `${column.label}: ${filled}; latest ${long(latest)}`,
      filled: stamps.length,
      total,
    };
  }
  if (column.summary === "filled") {
    return {
      short: `${stamps.length} filled`,
      long: `${column.label}: ${filled}`,
      filled: stamps.length,
      total,
    };
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
  if (column.summary === "filled") {
    return {
      short: `${labels.length} filled`,
      long: `${column.label}: ${labels.length} of ${total} filled`,
      filled: labels.length,
      total,
    };
  }
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

/** One selectable measure in the summary authoring list. */
export interface SummaryChoice {
  /** `""` is the format's default line. */
  value: SummaryKind | "";
  label: string;
}

/**
 * The measures a column's format can print, in the order an editor lists them.
 * The first entry is the default; an empty list means the format has no choice
 * (the title counts rows and a file set counts filled cells).
 */
export function summaryChoices(
  format: PropertyFormat | undefined,
  title = false,
): SummaryChoice[] {
  if (title) {
    return [];
  }
  switch (format) {
    case "number":
      return [
        { value: "", label: "Sum and average" },
        { value: "sum", label: "Sum" },
        { value: "average", label: "Average" },
        { value: "lowest", label: "Lowest" },
        { value: "highest", label: "Highest" },
        { value: "filled", label: "Filled count" },
      ];
    case "checkbox":
      return [
        { value: "", label: "Checked of filled" },
        { value: "checked", label: "Checked" },
        { value: "filled", label: "Filled count" },
      ];
    case "date":
    case "datetime":
      return [
        { value: "", label: "Earliest to latest" },
        { value: "earliest", label: "Earliest" },
        { value: "latest", label: "Latest" },
        { value: "filled", label: "Filled count" },
      ];
    case "text":
    case "select":
    case "multi_select":
    case "url":
    case "email":
    case "list":
      return [
        { value: "", label: "Distinct values" },
        { value: "distinct", label: "Distinct count" },
        { value: "filled", label: "Filled count" },
      ];
    default:
      return [];
  }
}

/**
 * The one line a column prints when its format offers no choice: the title
 * counts rows, and the formats that carry a set or a link count filled cells.
 * `null` means the format has neither a choice nor a fixed line.
 */
export function summaryFixedLabel(
  format: PropertyFormat | undefined,
  title = false,
): string | null {
  if (title) {
    return "Row count";
  }
  if (format !== undefined && COUNTED_FORMATS[format]) {
    return "Filled count";
  }
  return null;
}
