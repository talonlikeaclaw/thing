/** The space rail's links, in their shipped order. */
export type NavLink =
  | "overview"
  | "today"
  | "calendar"
  | "schedule"
  | "schema"
  | "library"
  | "members"
  | "settings"
  | "trash";

export const DEFAULT_NAV_ORDER: NavLink[] = [
  "overview",
  "today",
  "calendar",
  "schema",
  "library",
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
 * this build added placed beside its shipped neighbour.
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
  // A link this build adds lands beside its shipped neighbour rather than at
  // the end, so a rail saved before the link existed keeps its shape.
  for (const link of DEFAULT_NAV_ORDER) {
    if (order.includes(link)) {
      continue;
    }
    const shipped = DEFAULT_NAV_ORDER.indexOf(link);
    let insertAt = 0;
    for (let index = shipped - 1; index >= 0; index -= 1) {
      const previous = order.indexOf(DEFAULT_NAV_ORDER[index] as NavLink);
      if (previous !== -1) {
        insertAt = previous + 1;
        break;
      }
    }
    order.splice(insertAt, 0, link);
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

/**
 * The links a space can show, in the reader's order. Overview and the utility
 * pages always exist; Today needs a daily type and Calendar needs anything
 * dated, so a hidden link never takes a slot the reader cannot move it from.
 */
export function visibleNavOrder(
  order: readonly NavLink[],
  available: ReadonlySet<NavLink>,
): NavLink[] {
  return order.filter((link) => available.has(link));
}

/**
 * Moves one visible link one place in the direction `delta` names, swapping it
 * with its nearest visible neighbour. A hidden link keeps its stored slot, so
 * turning a daily type back on does not reshuffle the rail.
 */
export function moveNavLink(
  order: NavLink[],
  available: ReadonlySet<NavLink>,
  link: NavLink,
  delta: number,
): NavLink[] {
  if (delta === 0) {
    return order;
  }
  const visible = visibleNavOrder(order, available);
  const index = visible.indexOf(link);
  const neighbour = visible[index + (delta > 0 ? 1 : -1)];
  if (index === -1 || neighbour === undefined) {
    return order;
  }
  const next = [...order];
  const a = next.indexOf(link);
  const b = next.indexOf(neighbour);
  if (a === -1 || b === -1) {
    return order;
  }
  next[a] = neighbour;
  next[b] = link;
  return next;
}

/**
 * Whether one rail link is the page the reader is on.
 *
 * Today covers the whole journal, and a daily note is a record at `/o/:id`
 * once it exists, so `journalOpen` is the link's third case: the page under a
 * note of that type still belongs to Today.
 */
export function navLinkActive(
  link: NavLink,
  to: string,
  pathname: string,
  journalOpen: boolean,
): boolean {
  if (link !== "today") {
    return pathname === to;
  }
  return journalOpen || pathname === to || pathname.startsWith(`${to}/`);
}
