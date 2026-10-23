/** The list endpoint's cap, which is also one table page. */
export const PAGE_SIZE = 50;

/** A 1-based page from `?page=`; malformed or non-positive values mean page 1. */
export function pageFromParam(raw: string | null): number {
  if (raw === null) {
    return 1;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Always at least one page, so an empty type still has a page to show. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / PAGE_SIZE));
}

export function clampPage(page: number, total: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), pageCount(total));
}

/** The offset and inclusive row range one page covers; empty is `0..0`. */
export function pageRange(
  total: number,
  page: number,
): { offset: number; limit: number; first: number; last: number } {
  const safeTotal = Math.max(0, total);
  const offset = (clampPage(page, safeTotal) - 1) * PAGE_SIZE;
  return {
    offset,
    limit: PAGE_SIZE,
    first: safeTotal === 0 ? 0 : offset + 1,
    last: Math.min(offset + PAGE_SIZE, safeTotal),
  };
}
