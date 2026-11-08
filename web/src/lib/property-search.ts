import type { PropertyDef } from "@/api/types";

/**
 * Fold a property's name or key for matching: trimmed, lowercased, with runs of
 * whitespace collapsed to one space. Typing `room type` must find `Room  type`
 * without the user reproducing its spacing.
 */
export function foldProperty(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The match tiers, best first. A name beats a key at the same strength: a
 * person searches the word the table prints, not the key the file stores.
 */
const NAME_EXACT = 0;
const NAME_PREFIX = 1;
const NAME_PART = 2;
const KEY_EXACT = 3;
const KEY_PREFIX = 4;
const KEY_PART = 5;

/**
 * How well one property matches a query: a lower tier is a better match, and
 * `null` means no match at all. An empty query matches everything equally, so
 * a caller that wants the incoming order says so itself.
 */
export function scoreProperty(property: PropertyDef, query: string): number | null {
  const needle = foldProperty(query);
  if (needle === "") {
    return NAME_EXACT;
  }
  const name = foldProperty(property.name);
  const key = foldProperty(property.key);
  if (name === needle) {
    return NAME_EXACT;
  }
  if (name.startsWith(needle)) {
    return NAME_PREFIX;
  }
  if (name.includes(needle)) {
    return NAME_PART;
  }
  if (key === needle) {
    return KEY_EXACT;
  }
  if (key.startsWith(needle)) {
    return KEY_PREFIX;
  }
  if (key.includes(needle)) {
    return KEY_PART;
  }
  return null;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The properties matching `query`, best first, then by folded name and key so
 * the same query always prints the same list. An empty query returns the
 * properties unchanged: a picker that opens unfiltered shows its own order.
 */
export function searchProperties<T extends PropertyDef>(
  properties: readonly T[],
  query: string,
): T[] {
  if (foldProperty(query) === "") {
    return [...properties];
  }
  return properties
    .flatMap((property) => {
      const score = scoreProperty(property, query);
      return score === null ? [] : [{ property, score }];
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        compareText(foldProperty(left.property.name), foldProperty(right.property.name)) ||
        compareText(left.property.key, right.property.key),
    )
    .map((entry) => entry.property);
}

export interface PropertyGroups<T extends PropertyDef> {
  /** Properties the type being edited already carries. */
  onThisType: T[];
  /** Everything else in the space's property library. */
  inLibrary: T[];
}

/**
 * Split a property list by membership, keeping each half's order. The picker
 * prints the type's own properties first so the common choice is the first row.
 */
export function groupProperties<T extends PropertyDef>(
  properties: readonly T[],
  carried: ReadonlySet<string>,
): PropertyGroups<T> {
  const onThisType: T[] = [];
  const inLibrary: T[] = [];
  for (const property of properties) {
    (carried.has(property.key) ? onThisType : inLibrary).push(property);
  }
  return { onThisType, inLibrary };
}
