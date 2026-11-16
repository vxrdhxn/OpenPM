/**
 * Keyset ("cursor") pagination for list endpoints.
 *
 * A page is requested with `limit` (1-100, default 50) and, after the first page, the `cursor` the
 * previous page returned. Responses are `{ items, next_cursor }`; `next_cursor` is null on the last
 * page. Unlike OFFSET, rows inserted or deleted meanwhile never shift a page, and deep pages cost
 * the same as the first.
 *
 * The cursor holds the last row's sort value and id. The sort value is taken from Postgres as text
 * (`<expr>::text`) and cast back in the next query, so it round-trips exactly: a JS Date would drop
 * the microseconds of a timestamp, and the next page would then skip rows created in the same
 * millisecond. Cursors are opaque to clients (base64url JSON) and are validated, never trusted:
 * they only ever become bind parameters.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

/** JSON-schema properties shared by every paginated querystring. */
export const paginationQuerySchema = {
  limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE },
  cursor: { type: 'string', minLength: 1, maxLength: 512 },
} as const;

/** Free-text search parameter: bounded so it cannot be used to send huge patterns. */
export const searchQuerySchema = { type: 'string', minLength: 1, maxLength: 100 } as const;

export interface Cursor {
  /** The sort expression's value for the last row, as Postgres text. */
  key: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidCursorError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('Invalid cursor');
  }
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.key, cursor.id])).toString('base64url');
}

/** Throws InvalidCursorError (a 400) for anything that is not a cursor this API issued. */
export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    parsed[0].length > 64 ||
    typeof parsed[1] !== 'string' ||
    !UUID.test(parsed[1])
  ) {
    throw new InvalidCursorError();
  }
  return { key: parsed[0], id: parsed[1] };
}

/**
 * Split `limit + 1` fetched rows into the page and the next cursor. Each row must carry `sort_key`
 * (the sort expression as text) and `id`; `sort_key` is removed from the returned items.
 */
export function toPage<T extends { id: string; sort_key: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map(({ sort_key: _sortKey, ...item }) => item),
    next_cursor: hasMore && last ? encodeCursor({ key: last.sort_key, id: last.id }) : null,
  };
}

/** Escape LIKE/ILIKE wildcards so user input matches literally. Use with `ESCAPE '\\'`. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Collects SQL conditions and their bind parameters, so filters can be added in any combination
 * without hand-numbering `$n` placeholders.
 */
export class Conditions {
  private readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  /** Add a bind parameter and return its placeholder (`$n`). */
  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  /** Add a clause; `build` receives `param` to create placeholders. */
  add(build: (param: (value: unknown) => string) => string): this {
    this.clauses.push(build((v) => this.param(v)));
    return this;
  }

  sql(): string {
    return this.clauses.length ? this.clauses.join(' AND ') : 'TRUE';
  }
}
