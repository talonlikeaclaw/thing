/**
 * Handedness: a browser-local preference describing the device in the user's
 * hand, not the space. It moves thumb-zone controls and never reading order,
 * so the text, icons and table columns stay put in both modes.
 */
export type Handedness = "right" | "left";

export const DEFAULT_HANDEDNESS: Handedness = "right";

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface HandednessStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function handednessKey(userId: string): string {
  return `thing:handedness:${userId}`;
}

export function isHandedness(value: unknown): value is Handedness {
  return value === "right" || value === "left";
}

/**
 * An absent key, malformed value or refused read yields the default. A
 * refused read is swallowed: handedness never blocks the shell from loading.
 */
export function readHandedness(storage: HandednessStorage, key: string): Handedness {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return DEFAULT_HANDEDNESS;
  }
  return isHandedness(raw) ? raw : DEFAULT_HANDEDNESS;
}

/**
 * Persists one user's choice. A refused write is swallowed; the choice still
 * applies for the session and the UI stays quiet.
 */
export function writeHandedness(
  storage: HandednessStorage,
  key: string,
  value: Handedness,
): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Private mode or quota: the choice still applies for this session.
  }
}

/** Marks the root so layout can move to the thumb edge; right is the default. */
export function applyHandedness(root: HTMLElement, value: Handedness): void {
  if (value === "left") {
    root.dataset.hand = "left";
  } else {
    delete root.dataset.hand;
  }
}

/** Removes the marker outside a signed-in space shell. */
export function resetHandedness(root: HTMLElement): void {
  delete root.dataset.hand;
}
