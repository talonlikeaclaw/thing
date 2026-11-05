/**
 * Whether the space map spells out its record titles.
 *
 * A preference of the reader, not of the map: a dense space reads as dots and
 * edges, and the titles are one key away. Kept per user and space so hiding
 * them in a busy space does not hide them in every space.
 */

/**
 * The name a node shows. A shortened title stops at a space — `Monstera in…`,
 * never `Monstera in the s…` — so the map points at the record instead of
 * snipping a word in half.
 */
export function shortTitle(title: string, maxChars: number): string {
  if (title.length <= maxChars) {
    return title;
  }
  const cut = title.slice(0, maxChars - 1);
  const boundary = cut.lastIndexOf(" ");
  const head = boundary > 0 ? cut.slice(0, boundary) : cut;
  return `${head.trimEnd()}…`;
}

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface GraphLabelStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_GRAPH_LABELS = true;

export function graphLabelsKey(userId: string, spaceId: string): string {
  return `thing:graph-labels:${userId}:${spaceId}`;
}

/** Absent, refused or malformed reads show the titles: the map names itself. */
export function readGraphLabels(storage: GraphLabelStorage, key: string): boolean {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return DEFAULT_GRAPH_LABELS;
  }
  return raw !== "off";
}

/** Persists one reader's choice; a refused write leaves the session's choice. */
export function writeGraphLabels(
  storage: GraphLabelStorage,
  key: string,
  shown: boolean,
): void {
  try {
    storage.setItem(key, shown ? "on" : "off");
  } catch {
    // Private mode or quota: the choice still applies for this session.
  }
}
