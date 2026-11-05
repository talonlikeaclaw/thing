/**
 * Whether the desktop rail shows its labels or folds to icons.
 *
 * A reader's choice, not the space's: kept per user and space so folding a
 * busy ledger does not unfold every other space. The phone never reads it —
 * below `lg` the rail is the dock and the sheet, which do not fold.
 */

export type RailWidth = "wide" | "folded";

export const DEFAULT_RAIL: RailWidth = "wide";

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface RailStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function railKey(userId: string, spaceId: string): string {
  return `thing:rail:${userId}:${spaceId}`;
}

/** Absent, refused or malformed reads show the full rail. */
export function readRail(storage: RailStorage, key: string): RailWidth {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return DEFAULT_RAIL;
  }
  return raw === "folded" ? "folded" : "wide";
}

/** Persists one reader's choice; a refused write leaves the session's choice. */
export function writeRail(storage: RailStorage, key: string, width: RailWidth): void {
  try {
    storage.setItem(key, width);
  } catch {
    // Private mode or quota: the fold still applies for this session.
  }
}
