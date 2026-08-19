/**
 * PERF-002: keyset ("cursor") pagination helpers.
 *
 * Lists that can grow unboundedly (jobs, matches, inbox) use a stable sort
 * `(sortKey, id)` — the cursor is the last row's sort key + id, and the next
 * page is fetched with a "strictly after this key, tie-broken by id" predicate.
 * This avoids the offset-scan cost and stays correct under concurrent inserts.
 */

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, or null when this is the last page. */
  nextCursor: string | null;
  /** Number of rows matching the filters (ignoring the cursor), for UI totals. */
  total: number;
}

/** Encode a cursor payload as an opaque, URL-safe token (null keys allowed for nullable sort columns). */
export function encodeCursor(payload: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/** Decode a cursor token; returns null for anything malformed (fall back to page 1). */
export function decodeCursor(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

/** Parse and clamp a `limit` query param. */
export function parseLimit(raw: string | undefined, fallback = 50, max = 100): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

/**
 * Keyset predicate for "rows strictly after (key, id)" on a sort column.
 * `dir` matches the orderBy direction of that column; null keys are handled for
 * both directions (Prisma orders nulls first on asc, last on desc).
 */
export function keysetAfter(
  column: string,
  key: string | number | null,
  id: string,
  dir: 'asc' | 'desc',
): Record<string, unknown> {
  if (key === null) {
    return dir === 'asc'
      ? { OR: [{ [column]: null, id: { gt: id } }, { [column]: { not: null } }] }
      : { [column]: null, id: { lt: id } };
  }
  return dir === 'desc'
    ? { OR: [{ [column]: { lt: key } }, { [column]: key, id: { lt: id } }] }
    : { OR: [{ [column]: { gt: key } }, { [column]: key, id: { gt: id } }] };
}

/**
 * Slice `limit + 1` fetched rows down to a page. A `nextCursor` is produced only
 * when more rows exist, using `encode` over the last row of the page.
 */
export function pageFrom<T>(
  rows: T[],
  limit: number,
  encode: (last: T) => string | null,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore && items.length ? encode(items[items.length - 1]) : null,
  };
}
