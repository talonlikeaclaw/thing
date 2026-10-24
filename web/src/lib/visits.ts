/** The slice of `Storage` this module needs. */
export interface VisitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One user's last visit per space, as epoch milliseconds. */
export type Visits = Record<string, number>;

export function visitsKey(userId: string): string {
  return `thing:visited:${userId}`;
}

/** Malformed JSON, wrong shapes and non-finite times all yield an empty map. */
export function readVisits(storage: VisitStorage, key: string): Visits {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return {};
  }
  if (!raw) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const visits: Visits = {};
  for (const [spaceId, value] of Object.entries(parsed)) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      visits[spaceId] = value;
    }
  }
  return visits;
}

/** Writes one visit; a refused write leaves the list usable without ordering. */
export function recordVisit(
  storage: VisitStorage,
  key: string,
  spaceId: string,
  at: number,
): Visits {
  const visits = { ...readVisits(storage, key) };
  if (!Number.isFinite(at) || at < 0) {
    return visits;
  }
  visits[spaceId] = at;
  try {
    storage.setItem(key, JSON.stringify(visits));
  } catch {
    // Private mode or quota: the visit is best effort.
  }
  return visits;
}

/**
 * Most recent visit first, then name. A visited space always precedes an
 * unvisited one, and the id makes the order total.
 */
export function sortByVisit<T extends { id: string; name: string }>(
  spaces: readonly T[],
  visits: Visits,
): T[] {
  return [...spaces].sort((a, b) => {
    const left = visits[a.id];
    const right = visits[b.id];
    if (left !== undefined || right !== undefined) {
      if (left === undefined) {
        return 1;
      }
      if (right === undefined) {
        return -1;
      }
      if (left !== right) {
        return right - left;
      }
    }
    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id)
    );
  });
}
