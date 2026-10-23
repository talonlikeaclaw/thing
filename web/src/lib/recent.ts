/** One record the user opened, with the title as it looked at that moment. */
export interface RecentItem {
  id: string;
  type: string;
  title: string;
  at: string;
}

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_LIMIT = 12;

export function recentKey(userId: string, spaceId: string): string {
  return `thing:recent:${userId}:${spaceId}`;
}

function isRecentItem(value: unknown): value is RecentItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.type === "string" &&
    item.type.length > 0 &&
    typeof item.title === "string" &&
    item.title.length > 0 &&
    typeof item.at === "string" &&
    item.at.length > 0
  );
}

/** Malformed JSON or any wrong-shaped entry yields an empty list, never a throw. */
export function readRecent(storage: RecentStorage, key: string): RecentItem[] {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every(isRecentItem)) {
    return [];
  }
  return parsed.slice(0, RECENT_LIMIT);
}

/**
 * Puts one record at the front, updating its title snapshot and removing the
 * older entry. A refused write is swallowed: recents never block opening.
 */
export function recordRecent(
  storage: RecentStorage,
  key: string,
  item: Omit<RecentItem, "at">,
  at: string,
): RecentItem[] {
  const next = [
    { ...item, at },
    ...readRecent(storage, key).filter((existing) => existing.id !== item.id),
  ].slice(0, RECENT_LIMIT);
  try {
    storage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota, private mode or a disabled store: best effort only.
  }
  return next;
}
