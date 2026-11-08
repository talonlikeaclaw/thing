/** Filtering and ordering for the space library; the page renders what this returns. */

import type { Condition, LibraryItem, PropertyFormat } from "@/api/types";

/** The kind switch: everything, only images, only other files. */
export type LibraryKind = "all" | "image" | "file";

/** The three orders the toolbar offers. */
export type LibrarySort = "recent" | "name" | "size";

export interface LibraryFilter {
  kind: LibraryKind;
  /** Type keys; empty means every type. */
  types: readonly string[];
  /** A case-insensitive name fragment; empty means no name filter. */
  query: string;
}

export const EMPTY_LIBRARY_FILTER: LibraryFilter = { kind: "all", types: [], query: "" };

/** Whether any filter narrows the list; the empty state's Clear needs this. */
export function isFiltered(filter: LibraryFilter): boolean {
  return filter.kind !== "all" || filter.types.length > 0 || filter.query.trim() !== "";
}

/**
 * The latest moment a live record naming this file was saved, or `0` when only
 * trashed records (or none) name it.
 *
 * A trashed record must not keep a file at the top of Recent: it is no longer
 * what the reader last touched.
 */
export function liveUpdatedAt(item: LibraryItem): number {
  let latest = 0;
  for (const record of item.records) {
    if (record.trashed) {
      continue;
    }
    const at = Date.parse(record.updated_at);
    if (Number.isFinite(at) && at > latest) {
      latest = at;
    }
  }
  return latest;
}

function byName(left: LibraryItem, right: LibraryItem): number {
  return (
    left.name.toLowerCase().localeCompare(right.name.toLowerCase()) ||
    left.path.localeCompare(right.path)
  );
}

/** The items a kind, a set of types and a name fragment all accept. */
export function filterLibrary(
  items: readonly LibraryItem[],
  filter: LibraryFilter,
): LibraryItem[] {
  const needle = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.kind !== "all" && item.kind !== filter.kind) {
      return false;
    }
    if (needle !== "" && !item.name.toLowerCase().includes(needle)) {
      return false;
    }
    if (
      filter.types.length > 0 &&
      !item.records.some((record) => filter.types.includes(record.type_key))
    ) {
      return false;
    }
    return true;
  });
}

/**
 * A filtered list in one order.
 *
 * Recent puts the newest live save first and files no live record names last,
 * so collecting unused bytes never buries the photos in use. Name and Size are
 * total orders, so equal values still sort by path.
 */
export function sortLibrary(items: readonly LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const sorted = [...items];
  if (sort === "name") {
    sorted.sort(byName);
    return sorted;
  }
  if (sort === "size") {
    sorted.sort((left, right) => right.size - left.size || left.path.localeCompare(right.path));
    return sorted;
  }
  sorted.sort((left, right) => {
    const recent = liveUpdatedAt(right) - liveUpdatedAt(left);
    return recent !== 0 ? recent : byName(left, right);
  });
  return sorted;
}

/** The formats one value can narrow; lists of files and recurrence have no scalar. */
export type FilterableFormat =
  | "text"
  | "url"
  | "email"
  | "number"
  | "checkbox"
  | "select"
  | "multi_select"
  | "relation";

const FILTERABLE_FORMATS: readonly PropertyFormat[] = [
  "text",
  "url",
  "email",
  "number",
  "checkbox",
  "select",
  "multi_select",
  "relation",
];

/** Whether the library offers a value control for this property. */
export function isFilterableFormat(format: PropertyFormat): format is FilterableFormat {
  return FILTERABLE_FORMATS.includes(format);
}

/**
 * The condition one property filter contributes, or `null` while it holds no
 * value.
 *
 * The operator follows the format the property's own editor uses: equality for
 * a choice, a checkbox or a number; a substring for prose; containment for a
 * multi-select or a relation list, so any related record or tag matches.
 */
export function propertyCondition(
  key: string,
  format: FilterableFormat,
  value: unknown,
): Condition | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  switch (format) {
    case "checkbox":
      return typeof value === "boolean"
        ? { property: key, condition: "equal", value }
        : null;
    case "number": {
      const number = typeof value === "number" ? value : Number(String(value).trim());
      return Number.isFinite(number)
        ? { property: key, condition: "equal", value: number }
        : null;
    }
    case "select":
      return typeof value === "string"
        ? { property: key, condition: "equal", value }
        : null;
    case "multi_select":
    case "relation":
      return typeof value === "string"
        ? { property: key, condition: "contains", value }
        : null;
    case "text":
    case "url":
    case "email": {
      const text = typeof value === "string" ? value.trim() : "";
      return text === "" ? null : { property: key, condition: "contains", value: text };
    }
  }
}

/**
 * The items a property filter leaves: the server returns the records of one
 * type a condition matched, so a file stays when any of its records of that
 * type is in the set.
 *
 * A file whose only record is trashed never matches, because the object read
 * lists live records only; it returns when the property filter is cleared.
 */
export function filterByMatchedRecords(
  items: readonly LibraryItem[],
  typeKey: string,
  matched: ReadonlySet<string>,
): LibraryItem[] {
  return items.filter((item) =>
    item.records.some((record) => record.type_key === typeKey && matched.has(record.id)),
  );
}
