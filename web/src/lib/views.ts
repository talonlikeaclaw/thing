import type {
  Filter,
  ObjectSummary,
  PropertyDef,
  Sort,
  TypeDef,
  ViewDef,
} from "@/api/types";
import { filterFromParams, sortsFromParams } from "@/lib/filter";
import { moveColumn, sameJson, setColumn, TITLE_COLUMN } from "@/lib/schema";

export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 800;
export const TITLE_WIDTH = 240;
export const DEFAULT_COLUMN_WIDTH = 140;

/** The selected view and whether the URL named a key the type no longer has. */
export interface SelectedView {
  view: ViewDef;
  unknown: boolean;
}

/**
 * The URL's view when it exists, else the type's default. `unknown` is true
 * only for a named key that is gone, so the page can repair its URL instead of
 * rendering a mismatch.
 */
export function selectedView(type: TypeDef, key?: string): SelectedView {
  if (key) {
    const named = type.views.find((view) => view.key === key);
    if (named) {
      return { view: named, unknown: false };
    }
  }
  const fallback =
    type.views.find((view) => view.key === type.default_view) ?? type.views[0];
  if (!fallback) {
    throw new Error(`type ${type.key} has no views`);
  }
  return { view: fallback, unknown: Boolean(key) };
}

/** The query a renderer sends: URL overrides win, absent means the saved view. */
export function effectiveQuery(
  view: ViewDef,
  params: URLSearchParams,
): { filter: Filter; sorts: Sort[] } {
  return {
    filter: filterFromParams(params) ?? view.filter,
    sorts: sortsFromParams(params) ?? view.sorts,
  };
}

/** The same query without the page, for any edit that changes the result set. */
export function withoutPage(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("page");
  return next;
}

/** Normalizes the omitted `empty` placement so a default sort is not "dirty". */
function normalizedSorts(sorts: Sort[]): Sort[] {
  return sorts.map((sort) => ({
    property: sort.property,
    direction: sort.direction,
    empty: sort.empty ?? "end",
  }));
}

/** Whether the URL carries a filter or sort that differs from the saved view. */
export function queryIsDirty(view: ViewDef, filter: Filter, sorts: Sort[]): boolean {
  return !sameJson(
    { filter, sorts: normalizedSorts(sorts) },
    { filter: view.filter, sorts: normalizedSorts(view.sorts) },
  );
}

/** A column's saved width, or the renderer's default. */
export function defaultWidth(view: ViewDef, key: string): number {
  return view.widths?.[key] ?? (key === TITLE_COLUMN ? TITLE_WIDTH : DEFAULT_COLUMN_WIDTH);
}

/** CSS pixels a table column may occupy. */
export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return MIN_COLUMN_WIDTH;
  }
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

/** A view with one width set, as a layout PATCH sends it. */
export function withWidth(
  view: ViewDef,
  key: string,
  width: number,
): { columns: string[]; widths: Record<string, number> } {
  return {
    columns: [...view.columns],
    widths: { ...view.widths, [key]: clampWidth(width) },
  };
}

function titleFirst(columns: string[]): string[] {
  return [
    TITLE_COLUMN,
    ...columns.filter((column) => column !== TITLE_COLUMN),
  ];
}

/** A view without one column; `title` cannot be hidden. Widths follow. */
export function withoutColumn(
  view: ViewDef,
  key: string,
): { columns: string[]; widths: Record<string, number> } {
  const widths = { ...view.widths };
  if (key === TITLE_COLUMN) {
    return { columns: titleFirst(view.columns), widths };
  }
  delete widths[key];
  return { columns: setColumn(titleFirst(view.columns), key, false), widths };
}

/** A view with one column shown or hidden; `title` stays first. */
export function withColumn(
  view: ViewDef,
  key: string,
  include: boolean,
): { columns: string[]; widths: Record<string, number> } {
  if (!include) {
    return withoutColumn(view, key);
  }
  const widths = { ...view.widths };
  return { columns: setColumn(titleFirst(view.columns), key, true), widths };
}

/** Moves one column after the fixed title; `title` itself never moves. */
export function moveViewColumn(view: ViewDef, key: string, delta: number): string[] {
  return moveColumn(titleFirst(view.columns), key, delta);
}

/**
 * The 0-based slot one view moves to, or `null` when it is unknown or already
 * at an end. The server takes the target slot, so the client never sends a
 * neighbour key that another writer could have moved. `floor` is the first slot
 * the view may take — 1 for every non-default view, because the default is
 * always slot 0.
 */
export function movedViewSlot(
  views: readonly { key: string }[],
  key: string,
  delta: number,
  floor = 0,
): number | null {
  const from = views.findIndex((view) => view.key === key);
  if (from < 0) {
    return null;
  }
  const to = from + delta;
  if (to < floor || to >= views.length) {
    return null;
  }
  return to;
}

/** One board lane, in the order the board renders it. */
export interface BoardLane {
  key: string;
  label: string;
  rows: ObjectSummary[];
  /** True only for the trailing lane of records without a value. */
  noValue: boolean;
}

/** The raw select key a row carries, or `null` when it has no value. */
function selectKey(row: ObjectSummary, property: string): string | null {
  const value = row.values[property]?.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Groups rows into board lanes: the select property's options in their saved
 * order, then unknown values in key order, then `No value` when needed.
 */
export function groupRows(rows: ObjectSummary[], property: PropertyDef): BoardLane[] {
  const lanes = (property.options ?? []).map<BoardLane>((option) => ({
    key: option.key,
    label: option.name,
    rows: [],
    noValue: false,
  }));
  const byKey = new Map(lanes.map((lane) => [lane.key, lane]));
  const unknown = new Map<string, BoardLane>();
  const noValue: ObjectSummary[] = [];

  for (const row of rows) {
    const key = selectKey(row, property.key);
    if (key === null) {
      noValue.push(row);
      continue;
    }
    const known = byKey.get(key);
    if (known) {
      known.rows.push(row);
      continue;
    }
    let lane = unknown.get(key);
    if (!lane) {
      const label = row.values[property.key]?.label.trim();
      lane = { key, label: label || key, rows: [], noValue: false };
      unknown.set(key, lane);
    }
    lane.rows.push(row);
  }

  const orderedUnknown = [...unknown.values()].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return noValue.length > 0
    ? [...lanes, ...orderedUnknown, { key: "", label: "No value", rows: noValue, noValue: true }]
    : [...lanes, ...orderedUnknown];
}

/**
 * Rows keyed by their `YYYY-MM-DD` value, preserving the list's order. A row
 * without a valid date is left out; the calendar counts those separately.
 */
export function recordsByDate(
  rows: ObjectSummary[],
  property: string,
): Map<string, ObjectSummary[]> {
  const byDate = new Map<string, ObjectSummary[]>();
  for (const row of rows) {
    const value = row.values[property]?.value;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      continue;
    }
    const bucket = byDate.get(value);
    if (bucket) {
      bucket.push(row);
    } else {
      byDate.set(value, [row]);
    }
  }
  return byDate;
}

/** One cell of a month grid; adjacent-month days keep their real date. */
export interface MonthCell {
  date: string;
  inMonth: boolean;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A Monday-first month grid, built entirely in UTC so no date shifts. */
export function monthGrid(year: number, month: number): MonthCell[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = Math.ceil((offset + days) / 7) * 7;
  const start = Date.UTC(year, month - 1, 1 - offset);

  return Array.from({ length: cells / 7 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const date = new Date(start + (week * 7 + day) * 86_400_000);
      return {
        date: isoDate(date),
        inMonth: date.getUTCFullYear() === year && date.getUTCMonth() === month - 1,
      };
    }),
  );
}

/** The month a date string belongs to. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** `YYYY-MM` moved by whole months, using UTC arithmetic. */
export function addMonths(month: string, delta: number): string {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const index = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(index)) {
    return month;
  }
  const date = new Date(Date.UTC(year, index - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
