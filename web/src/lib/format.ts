import type { PropertyDef, PropertyFormat } from "@/api/types";
import { shortId } from "@/lib/display";
import { recurrenceSummary } from "@/lib/schedule";

/** Whether a value counts as unset, matching the server's empty-key rule. */
export function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** An option's display name, or its key when the property no longer defines it. */
export function optionName(property: PropertyDef, key: string): string {
  return property.options?.find((option) => option.key === key)?.name ?? key;
}

/**
 * A type key resolved to its display name. The key is only the fallback while
 * the type list is loading or the type is gone; it never stands in for a name.
 */
export function typeLabel(
  types: readonly { key: string; name: string }[] | undefined,
  key: string,
): string {
  return types?.find((type) => type.key === key)?.name ?? key;
}

/** One current relation target: its stored id and the title to read. */
export interface RelationChip {
  id: string;
  title: string;
}

/**
 * The current relation targets as chips, mapped from the server's joined
 * `label` so the record page needs no target fetch to read its own value.
 *
 * A missing target's label is its own id; the chip shows the id's tail instead
 * of a UUID. When the joined label cannot be split into one part per id (a
 * title containing ", "), every chip falls back to the id's tail rather than
 * pairing a title with the wrong record.
 */
export function relationChips(ids: readonly string[], label: string): RelationChip[] {
  const title = (part: string | undefined, id: string) =>
    part === undefined || part === "" || part === id ? shortId(id) : part;
  const [first, ...rest] = ids;
  if (first === undefined) {
    return [];
  }
  const text = label.trim();
  if (rest.length === 0) {
    return [{ id: first, title: title(text, first) }];
  }
  const parts = text.split(", ");
  const aligned = parts.length === ids.length;
  return ids.map((id, index) => ({ id, title: title(aligned ? parts[index] : undefined, id) }));
}

function plain(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  return "";
}

/**
 * What a cell shows for a raw value, computed exactly as the server labels it.
 *
 * Used for optimistic rows between the click and the refetch; server responses
 * carry their own `label`, so the two never disagree for long.
 */
export function valueLabel(
  format: PropertyFormat,
  value: unknown,
  property: PropertyDef | undefined,
  relationTitles?: ReadonlyMap<string, string>,
): string {
  if (isBlank(value)) {
    return "";
  }
  switch (format) {
    case "select":
      return typeof value === "string" && property ? optionName(property, value) : plain(value);
    case "multi_select":
      return Array.isArray(value)
        ? value
            .map((item) => (property && typeof item === "string" ? optionName(property, item) : String(item)))
            .join(", ")
        : plain(value);
    case "relation": {
      const ids = Array.isArray(value) ? value : [value];
      return ids
        .map((id) => (typeof id === "string" ? relationTitles?.get(id) ?? id : String(id)))
        .join(", ");
    }
    case "recurrence":
      return recurrenceSummary(value);
    default:
      return plain(value);
  }
}

/** The text a text-like input starts with; lists and booleans are not text. */
export function inputText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** `2026-10-20T12:30:00Z` as a `datetime-local` value in the user's zone. */
export function datetimeLocal(iso: unknown): string {
  if (typeof iso !== "string") {
    return "";
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return "";
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A `YYYY-MM-DD` calendar date, or `undefined` when it names no real day. */
export function parseCalendarDate(text: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return undefined;
  }
  const at = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== text
    ? undefined
    : text;
}

/** What a `datetime-local` field holds, as the RFC 3339 string the store keeps. */
export function fromDatetimeLocal(local: string): string | null {
  if (!local) {
    return null;
  }
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Parses a user's text into the JSON value a write carries.
 *
 * `null` clears the key, `undefined` means the text is not a valid value for
 * this format (the input keeps the text and commits nothing).
 */
export function parseCellText(format: PropertyFormat, text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  switch (format) {
    case "number": {
      const number = Number(trimmed);
      return Number.isFinite(number) ? number : undefined;
    }
    case "date":
      return parseCalendarDate(trimmed);
    case "datetime": {
      const at = new Date(trimmed);
      return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
    }
    case "url":
    case "email":
      return trimmed;
    case "recurrence":
      // A recurrence is a mapping with its own control; text cannot express it.
      return undefined;
    default:
      return text;
  }
}

/** Whether a cell's raw value is truthy, for the checkbox cell's mark. */
export function isChecked(value: unknown): boolean {
  return value === true;
}

/** A time as the reader's browser says it, for recent lists and palette rows. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) {
    return "";
  }
  const seconds = Math.round((at - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}
