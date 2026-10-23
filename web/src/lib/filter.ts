import type {
  CondOp,
  Condition,
  Filter,
  PropertyDef,
  PropertyFormat,
  Sort,
  SortDirection,
  TypeDef,
} from "@/api/types";
import { parseCellText } from "@/lib/format";
import { effectiveMembers } from "@/lib/schema";

/** Stable labels for every condition the engine understands. */
export const CONDITION_LABELS: Record<CondOp, string> = {
  equal: "is",
  not_equal: "is not",
  greater: "is greater than",
  less: "is less than",
  greater_or_equal: "is at least",
  less_or_equal: "is at most",
  contains: "contains",
  not_contains: "does not contain",
  in: "is any of",
  not_in: "is none of",
  all_in: "contains all of",
  is_empty: "is empty",
  is_not_empty: "is not empty",
};

const TEXT_OPS: CondOp[] = ["equal", "not_equal", "contains", "not_contains"];
const NUMBER_OPS: CondOp[] = [
  "equal",
  "not_equal",
  "greater",
  "less",
  "greater_or_equal",
  "less_or_equal",
];

/** The conditions the filter bar offers for one column. */
export function operatorsFor(format: PropertyFormat): CondOp[] {
  const empty: CondOp[] = ["is_empty", "is_not_empty"];
  switch (format) {
    case "text":
    case "url":
    case "email":
      return [...TEXT_OPS, ...empty];
    case "number":
    case "date":
    case "datetime":
      return [...NUMBER_OPS, ...empty];
    case "checkbox":
      return ["equal", "not_equal", ...empty];
    case "select":
      return ["equal", "not_equal", ...empty];
    case "multi_select":
      return ["contains", "not_contains", ...empty];
    case "relation":
    case "recurrence":
      return ["equal", "not_equal", ...empty];
  }
}

/** Whether the condition carries a value at all. */
export function conditionTakesValue(condition: CondOp): boolean {
  return condition !== "is_empty" && condition !== "is_not_empty";
}

/** Whether the value must be a JSON list, which the bar edits as several values. */
export function conditionTakesList(condition: CondOp): boolean {
  return condition === "in" || condition === "not_in" || condition === "all_in";
}

/** Every column a filter or sort may name: `title`, each property, `updated_at`. */
export interface ColumnChoice {
  key: string;
  label: string;
  format: PropertyFormat;
}

export function columnChoices(type: TypeDef, properties: PropertyDef[]): ColumnChoice[] {
  const byKey = new Map(properties.map((property) => [property.key, property]));
  const columns: ColumnChoice[] = [{ key: "title", label: "Title", format: "text" }];
  for (const member of effectiveMembers(type)) {
    const property = byKey.get(member.key);
    if (property) {
      columns.push({ key: property.key, label: property.name, format: property.format });
    }
  }
  columns.push({ key: "updated_at", label: "Updated", format: "datetime" });
  return columns;
}

export function columnChoice(columns: ColumnChoice[], key: string): ColumnChoice | undefined {
  return columns.find((column) => column.key === key);
}

/** A new condition of the default format for a column; it starts without a value. */
export function newCondition(column: ColumnChoice): Condition {
  return { property: column.key, condition: operatorsFor(column.format)[0] ?? "equal" };
}

/**
 * Whether a condition carries everything the server needs. A row being edited
 * is a draft until it does; drafts stay in the bar and never reach the wire.
 */
export function conditionIsComplete(condition: Condition): boolean {
  if (!conditionTakesValue(condition.condition)) {
    return true;
  }
  const value = condition.value;
  if (value === undefined || value === null || value === "") {
    return false;
  }
  return !Array.isArray(value) || value.length > 0;
}

/** The filter the query and a saved view carry: complete conditions only. */
export function completeFilter(filter: Filter): Filter {
  return {
    op: filter.op,
    conditions: filter.conditions.filter(conditionIsComplete),
  };
}

/** Changes the operator and drops any value the new operator cannot carry. */
export function withConditionOp(condition: Condition, op: CondOp): Condition {
  return conditionTakesValue(op)
    ? { ...condition, condition: op }
    : { property: condition.property, condition: op };
}

export function withConditionValue(condition: Condition, value: unknown): Condition {
  if (!conditionTakesValue(condition.condition) || value === null || value === "") {
    return { property: condition.property, condition: condition.condition };
  }
  return { ...condition, value };
}

/** Reads a condition's value from its text field, in the column's own format. */
export function parseConditionText(
  condition: CondOp,
  format: PropertyFormat,
  text: string,
): unknown {
  if (!conditionTakesValue(condition)) {
    return null;
  }
  if (conditionTakesList(condition)) {
    const items = text
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "")
      .map((item) => parseScalar(condition, format, item));
    return items.length === 0 ? null : items;
  }
  return parseScalar(condition, format, text);
}

function parseScalar(condition: CondOp, format: PropertyFormat, text: string) {
  if (format === "checkbox" && conditionTakesValue(condition)) {
    if (text === "true") {
      return true;
    }
    if (text === "false") {
      return false;
    }
    return undefined;
  }
  return parseCellText(format, text);
}

/** The text a condition's value field shows. */
export function conditionText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }
  return String(value);
}

/** The default order a new sort appends. */
export const DEFAULT_SORT_DIRECTION: SortDirection = "asc";

/**
 * One header click: ascending, then descending, then removed. Without Shift
 * the column becomes the only sort; with Shift it joins or leaves the list.
 */
export function cycleSort(sorts: Sort[], property: string, additive: boolean): Sort[] {
  const current = sorts.find((sort) => sort.property === property);
  if (!current) {
    const next: Sort = { property, direction: "asc" };
    return additive ? [...sorts, next] : [next];
  }
  if (current.direction === "asc") {
    const flipped: Sort = { ...current, direction: "desc" };
    return additive
      ? sorts.map((sort) => (sort.property === property ? flipped : sort))
      : [flipped];
  }
  return additive ? sorts.filter((sort) => sort.property !== property) : [];
}

/** Appends a sort once per property; sorting by the same column twice is noise. */
export function addSort(sorts: Sort[], property: string): Sort[] {
  if (sorts.some((sort) => sort.property === property)) {
    return sorts;
  }
  return [...sorts, { property, direction: DEFAULT_SORT_DIRECTION, empty: "end" }];
}

export function removeSort(sorts: Sort[], property: string): Sort[] {
  return sorts.filter((sort) => sort.property !== property);
}

export function moveSort(sorts: Sort[], property: string, delta: number): Sort[] {
  const from = sorts.findIndex((sort) => sort.property === property);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= sorts.length) {
    return sorts;
  }
  const next = sorts.slice();
  const [moved] = next.splice(from, 1);
  if (moved) {
    next.splice(to, 0, moved);
  }
  return next;
}

export function withSortDirection(sorts: Sort[], property: string, direction: SortDirection): Sort[] {
  return sorts.map((sort) => (sort.property === property ? { ...sort, direction } : sort));
}

export function withSortEmpty(
  sorts: Sort[],
  property: string,
  empty: "start" | "end",
): Sort[] {
  return sorts.map((sort) => (sort.property === property ? { ...sort, empty } : sort));
}

/** A URL parameter's JSON, or `undefined` when it is absent or malformed. */
export function readJsonParam(params: URLSearchParams, name: string): unknown {
  const raw = params.get(name);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function conditionsOf(parsed: unknown): unknown[] | undefined {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  if (!("conditions" in parsed) || !Array.isArray(parsed.conditions)) {
    return undefined;
  }
  return parsed.conditions;
}

/** The filter a URL carries, accepted only when it has the shape the engine reads. */
export function filterFromParams(params: URLSearchParams): Filter | undefined {
  const parsed = readJsonParam(params, "filter");
  const rawConditions = conditionsOf(parsed);
  if (!rawConditions || typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const op = "op" in parsed && parsed.op === "or" ? "or" : "and";
  const conditions: Condition[] = [];
  for (const item of rawConditions) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("property" in item) ||
      typeof item.property !== "string" ||
      !("condition" in item) ||
      typeof item.condition !== "string"
    ) {
      return undefined;
    }
    conditions.push({
      property: item.property,
      condition: item.condition as CondOp,
      ...("value" in item ? { value: item.value } : {}),
    });
  }
  return { op, conditions };
}

/** The sorts a URL carries; an empty or malformed list is no override. */
export function sortsFromParams(params: URLSearchParams): Sort[] | undefined {
  const parsed = readJsonParam(params, "sorts");
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const sorts: Sort[] = [];
  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      !("property" in item) ||
      typeof item.property !== "string"
    ) {
      return undefined;
    }
    const direction = "direction" in item && item.direction === "desc" ? "desc" : "asc";
    const empty = "empty" in item && item.empty === "start" ? "start" : "end";
    sorts.push({ property: item.property, direction, empty });
  }
  return sorts;
}

/** A copy of the params with one key set, or removed when the value is null. */
export function withParam(
  params: URLSearchParams,
  key: string,
  value: string | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === null || value === "") {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  return next;
}

/** A filter as the URL carries it; an empty filter is an explicit "no filter". */
export function filterParam(filter: Filter): string {
  return JSON.stringify(filter);
}

/** Sorts as the URL carries them; an empty list is an explicit "no sort". */
export function sortsParam(sorts: Sort[]): string {
  return JSON.stringify(sorts);
}
