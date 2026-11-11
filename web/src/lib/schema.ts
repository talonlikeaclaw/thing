import type {
  Aggregate,
  OptionDef,
  PropertyDef,
  PropertyFormat,
  TypeDef,
  TypeProperty,
} from "@/api/types";

/** The server's limit for a type or property key, in characters. */
const MAX_KEY_LEN = 40;

/**
 * The key a display name derives, mirroring `key_from_name` in
 * `crates/core/src/slug.rs`: lowercase ASCII folded word-wise into `_`, a name
 * starting with a digit prefixed `key_`, and nothing left reading `untitled`.
 *
 * Used only to notice when a shipped key says no more than the name already
 * does; the server stays the authority on the key it minted.
 */
export function keyFromName(name: string): string {
  let key = "";
  let separator = false;
  for (const char of name) {
    if (/[a-z0-9]/i.test(char)) {
      if (separator && key !== "") {
        key += "_";
      }
      separator = false;
      key += char.toLowerCase();
    } else {
      separator = key !== "";
    }
  }
  key = key.replace(/_+$/, "");
  if (key === "") {
    return "untitled";
  }
  if (!/^[a-z]/.test(key)) {
    key = `key_${key}`;
  }
  return [...key].slice(0, MAX_KEY_LEN).join("").replace(/_+$/, "");
}

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
  { value: "recurrence", label: "Recurrence" },
  { value: "file", label: "File" },
  { value: "image", label: "Image" },
  { value: "attachments", label: "Attachments" },
  { value: "list", label: "List" },
];

/**
 * Every format a stored property may carry. `list` is computed-only: its items
 * are display labels a rollup produced, so nothing may store one.
 */
export const STORED_FORMATS = PROPERTY_FORMATS.filter(
  (entry) => entry.value !== "list",
);

/** Every format a calculated property's result may take. */
export const RESULT_FORMATS: PropertyFormat[] = [
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "list",
];

/** Whether the app derives this property's value instead of storing it. */
export function isComputed(property: PropertyDef): boolean {
  return property.compute !== undefined;
}

/**
 * The one word a calculated property is called by, or `null` for a stored one.
 * Every chip, caption and menu uses this so the two kinds never drift.
 */
export function computeKindLabel(property: PropertyDef): "Formula" | "Rollup" | null {
  switch (property.compute?.kind) {
    case "formula":
      return "Formula";
    case "rollup":
      return "Rollup";
    default:
      return null;
  }
}

/** The properties a write may carry a value for: a computed one never. */
export function writableProperties(properties: readonly PropertyDef[]): PropertyDef[] {
  return properties.filter((property) => !isComputed(property));
}

/** The format a rollup's result takes, or nothing when the pair cannot hold one. */
export function rollupResultFormat(
  aggregate: Aggregate | undefined,
  targetFormat: PropertyFormat | undefined,
): PropertyFormat | undefined {
  switch (aggregate) {
    case "count":
      return "number";
    case "sum":
      return "number";
    case "min":
    case "max":
      return targetFormat === "number" ||
        targetFormat === "date" ||
        targetFormat === "datetime"
        ? targetFormat
        : undefined;
    case "list":
      return "list";
    default:
      return targetFormat === "number" ? "number" : undefined;
  }
}

/** A library lookup for the definition's own words; absent names fall back to key. */
function nameOf(key: string | undefined, properties: readonly PropertyDef[]): string {
  if (key === undefined) {
    return "";
  }
  if (key === "title") {
    return "Title";
  }
  return properties.find((property) => property.key === key)?.name ?? key;
}

/**
 * One sentence naming how a calculated property gets its value, for a cell's
 * tooltip and a field's caption. The formula's own text is the description;
 * a rollup names its aggregate, relation and target property.
 */
export function computeDescription(
  property: PropertyDef,
  properties: readonly PropertyDef[],
): string {
  const compute = property.compute;
  if (!compute) {
    return "";
  }
  if (compute.kind === "formula") {
    return compute.expression ? `Formula: ${compute.expression}` : "Formula";
  }
  const relation = nameOf(compute.relation, properties);
  switch (compute.aggregate) {
    case "count":
      return `Rollup: count of ${relation || "related records"}`;
    case "sum":
    case "min":
    case "max": {
      const target = nameOf(compute.property, properties);
      const verb = compute.aggregate;
      return `Rollup: ${verb} of ${target || "a value"} in ${relation || "related records"}`;
    }
    case "list": {
      const target = nameOf(compute.property, properties);
      return `Rollup: list of ${target || "values"} in ${relation || "related records"}`;
    }
    default:
      return `Rollup from ${relation || "related records"}`;
  }
}

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

/** Every property a type exposes: its declared library plus generated schedule keys. */
export function effectiveProperties(
  type: TypeDef | undefined,
  declared: PropertyDef[],
): PropertyDef[] {
  const implicit = (type?.implicit_properties ?? []).filter(
    (property) => !declared.some((known) => known.key === property.key),
  );
  return implicit.length === 0 ? declared : [...declared, ...implicit];
}

/** The type's members, declared first: what a table, filter and panel may name. */
export function effectiveMembers(type: TypeDef): TypeProperty[] {
  const declared = type.properties;
  if (!type.schedule) {
    return declared;
  }
  const generated = (type.implicit_properties ?? []).map((property) => property.key);
  return [
    ...declared,
    ...generated
      .filter((key) => !declared.some((member) => member.key === key))
      .map((key) => ({ key, required: false, featured: true })),
  ];
}

/**
 * The definitions of the properties this type actually carries, in member order.
 *
 * The space library holds every property, including ones a type does not carry.
 * A table and its view controls may only name members, so they start here.
 */
export function memberProperties(
  type: TypeDef | undefined,
  declared: PropertyDef[],
): PropertyDef[] {
  if (!type) {
    return [];
  }
  const byKey = new Map(
    effectiveProperties(type, declared).map((property) => [property.key, property]),
  );
  return effectiveMembers(type).flatMap((member) => {
    const property = byKey.get(member.key);
    return property ? [property] : [];
  });
}

/**
 * Library properties the type may still add: not already carried, and not a
 * generated schedule key the type does not own.
 */
export function availableProperties(
  type: TypeDef,
  library: PropertyDef[],
): PropertyDef[] {
  const taken = new Set(type.properties.map((member) => member.key));
  for (const implicit of type.implicit_properties ?? []) {
    taken.add(implicit.key);
  }
  return library.filter((property) => !taken.has(property.key));
}

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
