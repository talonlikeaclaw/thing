import type { RecentStorage } from "@/lib/recent";

export const EMOJI_RECENT_KEY = "thing:emoji:recent";
export const EMOJI_RECENT_LIMIT = 8;

/** Longest stored glyph: a ZWJ family sequence is 11 UTF-16 units. */
const EMOJI_MAX_LENGTH = 32;

function isEmoji(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= EMOJI_MAX_LENGTH;
}

/**
 * Malformed JSON, a wrong-shaped entry or a refused read yields an empty list,
 * never a throw. Duplicates are dropped: a glyph is either recent or not.
 */
export function readEmojiRecent(storage: RecentStorage): string[] {
  let raw: string | null;
  try {
    raw = storage.getItem(EMOJI_RECENT_KEY);
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
  if (!Array.isArray(parsed) || !parsed.every(isEmoji)) {
    return [];
  }
  return [...new Set(parsed)].slice(0, EMOJI_RECENT_LIMIT);
}

/**
 * Puts one glyph at the front, deduped and capped. A refused write is
 * swallowed: recents are a convenience and never block choosing an icon.
 */
export function recordEmojiRecent(storage: RecentStorage, char: string): string[] {
  if (!isEmoji(char)) {
    return readEmojiRecent(storage);
  }
  const next = [char, ...readEmojiRecent(storage).filter((existing) => existing !== char)].slice(
    0,
    EMOJI_RECENT_LIMIT,
  );
  try {
    storage.setItem(EMOJI_RECENT_KEY, JSON.stringify(next));
  } catch {
    // Quota, private mode or a disabled store: best effort only.
  }
  return next;
}
