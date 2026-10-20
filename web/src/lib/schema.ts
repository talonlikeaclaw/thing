import type { OptionDef, PropertyFormat, TypeProperty } from "@/api/types";

export const PROPERTY_FORMATS: { value: PropertyFormat; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date and time" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "relation", label: "Relation" },
];

const FORMAT_LABELS = Object.fromEntries(
  PROPERTY_FORMATS.map(({ value, label }) => [value, label]),
) as Record<PropertyFormat, string>;

export function formatLabel(format: PropertyFormat): string {
  return FORMAT_LABELS[format];
}

export function hasOptions(format: PropertyFormat): boolean {
  return format === "select" || format === "multi_select";
}

/** A new option's colour until the user picks one; option colour is user data. */
export const DEFAULT_OPTION_COLOR = "#c8d96b";

/** What a colour input can show; an unset or malformed colour falls back. */
export function colorValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_OPTION_COLOR;
}

export const TITLE_COLUMN = "title";

/** Compares JSON-shaped values without caring about object key order. */
export function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) {
    return false;
  }
  return leftKeys.every(
    (key) => key in rightRecord && sameJson(leftRecord[key], rightRecord[key]),
  );
}

/** Moves one item; an out-of-range move leaves the list untouched. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return items;
  }
  const next = items.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) {
    return items;
  }
  next.splice(to, 0, item);
  return next;
}

/** Appends a property once; a key already in the list is left where it is. */
export function addProperty(properties: TypeProperty[], key: string): TypeProperty[] {
  if (properties.some((member) => member.key === key)) {
    return properties;
  }
  return [...properties, { key, required: false, featured: false }];
}

export function removeProperty(properties: TypeProperty[], key: string): TypeProperty[] {
  return properties.filter((member) => member.key !== key);
}

export function moveProperty(
  properties: TypeProperty[],
  key: string,
  delta: number,
): TypeProperty[] {
  const from = properties.findIndex((member) => member.key === key);
  return from === -1 ? properties : moveItem(properties, from, from + delta);
}

/** Adds or removes a column; `title` stays first and cannot be removed. */
export function setColumn(columns: string[], key: string, include: boolean): string[] {
  if (key === TITLE_COLUMN) {
    return columns.includes(TITLE_COLUMN) ? columns : [TITLE_COLUMN, ...columns];
  }
  const rest = columns.filter((column) => column !== key);
  return include ? [...rest, key] : rest;
}

/** Moves a column after the fixed `title`; `title` itself never moves. */
export function moveColumn(columns: string[], key: string, delta: number): string[] {
  if (key === TITLE_COLUMN) {
    return columns;
  }
  const from = columns.indexOf(key);
  if (from < 1) {
    return columns;
  }
  const to = Math.max(1, from + delta);
  return moveItem(columns, from, to);
}

/** An option being edited: `id` is stable for React, `key` exists once saved. */
export interface OptionDraft {
  id: string;
  key?: string;
  name: string;
  color: string;
}

export function optionDrafts(options: OptionDef[] | undefined): OptionDraft[] {
  return (options ?? []).map((option) => ({
    id: option.key,
    key: option.key,
    name: option.name,
    color: option.color,
  }));
}

/** Sends a saved option's key back with it; a new option lets the server mint one. */
export function optionInputs(drafts: OptionDraft[]) {
  return drafts.map((draft) => ({
    ...(draft.key === undefined ? {} : { key: draft.key }),
    name: draft.name.trim(),
    color: draft.color.trim(),
  }));
}
