/**
 * A title-substring score for the command palette, not a search index.
 *
 * Matching is a case-insensitive subsequence; the score rewards a prefix, a
 * match that starts a word and adjacent characters, so "pla" ranks "Plant"
 * above "A large plant". A query that is not a subsequence scores `null`.
 */
export function score(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase();
  const haystack = text.toLowerCase();
  if (needle.length === 0) {
    return 0;
  }

  let cursor = 0;
  let previous = -2;
  let first = -1;
  let run = 0;
  let total = 0;

  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index === -1) {
      return null;
    }
    if (first === -1) {
      first = index;
    }
    total += 10;
    if (index === previous + 1) {
      run += 1;
      total += 4 + Math.min(run, 4) * 2;
    } else {
      run = 0;
      total -= Math.min(index - cursor, 6);
    }
    if (index === 0 || !/[a-z0-9]/.test(haystack[index - 1] ?? "")) {
      total += 8;
    }
    previous = index;
    cursor = index + 1;
  }

  if (haystack.startsWith(needle)) {
    total += 40;
  }
  if (haystack === needle) {
    total += 60;
  }
  total -= Math.max(0, previous - first + 1 - needle.length);
  return total;
}

/** Items ordered by score, ties kept in input order; an empty query keeps order. */
export function rank<T>(query: string, items: readonly T[], text: (item: T) => string): T[] {
  if (query.trim() === "") {
    return [...items];
  }
  return items
    .map((item, index) => ({ item, index, score: score(query, text(item)) }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.index - right.index)
    .map((entry) => entry.item);
}

/**
 * The ranges of `text` a query names, for marking a snippet.
 *
 * Every alphanumeric run in the query is matched case-insensitively in the
 * original text, so the indices always slice the string React renders. Ranges
 * are sorted and merged; an empty query marks nothing.
 */
export function matchRanges(text: string, query: string): Array<[number, number]> {
  const tokens = [
    ...new Set(
      (query.match(/[\p{L}\p{N}]+/gu) ?? [])
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 0),
    ),
  ].slice(0, 8);
  if (tokens.length === 0) {
    return [];
  }

  const found: Array<[number, number]> = [];
  for (const token of tokens) {
    const pattern = new RegExp(escapePattern(token), "giu");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      found.push([start, start + match[0].length]);
    }
  }
  found.sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const merged: Array<[number, number]> = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
