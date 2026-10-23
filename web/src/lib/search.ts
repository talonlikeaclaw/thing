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
