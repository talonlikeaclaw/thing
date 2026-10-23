/** The space rail's links, in their shipped order. */
export type NavLink = "schedule" | "schema" | "members" | "settings" | "trash";

export const DEFAULT_NAV_ORDER: NavLink[] = [
  "schema",
  "schedule",
  "members",
  "trash",
  "settings",
];

/** The slice of `Storage` this module needs. */
export interface NavOrderStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function navOrderKey(userId: string, spaceId: string): string {
  return `thing:nav-order:${userId}:${spaceId}`;
}

function isNavLink(value: unknown): value is NavLink {
  return typeof value === "string" && DEFAULT_NAV_ORDER.includes(value as NavLink);
}

/**
 * A saved order with unknown entries dropped, duplicates removed and any link
 * this build added appended in its default position at the end.
 */
export function readNavOrder(storage: NavOrderStorage, key: string): NavLink[] {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [...DEFAULT_NAV_ORDER];
  }
  if (!raw) {
    return [...DEFAULT_NAV_ORDER];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [...DEFAULT_NAV_ORDER];
  }
  if (!Array.isArray(parsed)) {
    return [...DEFAULT_NAV_ORDER];
  }

  const order: NavLink[] = [];
  for (const value of parsed) {
    if (isNavLink(value) && !order.includes(value)) {
      order.push(value);
    }
  }
  for (const link of DEFAULT_NAV_ORDER) {
    if (!order.includes(link)) {
      order.push(link);
    }
  }
  return order;
}

/** Persists one user's rail order; a refused write leaves the session usable. */
export function writeNavOrder(storage: NavOrderStorage, key: string, order: NavLink[]): void {
  try {
    storage.setItem(key, JSON.stringify(order));
  } catch {
    // Private mode or quota: the reordered rail still works for this view.
  }
}

/** Moves one link by `delta` places, bounded at both ends. */
export function moveNavLink(order: NavLink[], link: NavLink, delta: number): NavLink[] {
  const index = order.indexOf(link);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= order.length) {
    return order;
  }
  const next = [...order];
  const [moved] = next.splice(index, 1);
  if (!moved) {
    return order;
  }
  next.splice(target, 0, moved);
  return next;
}
