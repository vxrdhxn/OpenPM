import { describe, expect, it } from 'vitest';
import { Conditions, decodeCursor, encodeCursor, InvalidCursorError, likePattern, toPage } from './pagination';
import { applyTaskFilters, taskSortExpression } from './taskFilters';

const ID = '3f1c2b9e-6a4d-4c1e-9b7a-2d5e8f0a1b2c';

describe('cursors', () => {
  it('round-trips the exact Postgres text, microseconds included', () => {
    const cursor = { key: '2026-11-16 09:05:03.123456+00', id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['not base64 JSON', '!!!'],
    ['wrong shape', Buffer.from(JSON.stringify({ key: 'x', id: ID })).toString('base64url')],
    ['non-uuid id', Buffer.from(JSON.stringify(['x', "1' OR '1'='1"])).toString('base64url')],
    ['oversized key', Buffer.from(JSON.stringify(['x'.repeat(65), ID])).toString('base64url')],
    ['non-string key', Buffer.from(JSON.stringify([1, ID])).toString('base64url')],
  ])('rejects %s with a 400', (_label, raw) => {
    expect(() => decodeCursor(raw)).toThrow(InvalidCursorError);
    try {
      decodeCursor(raw);
    } catch (err) {
      expect((err as InvalidCursorError).statusCode).toBe(400);
    }
  });
});

describe('toPage', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `${ID.slice(0, -1)}${i}`, sort_key: `k${i}`, name: `p${i}` }));

  it('returns a cursor to the last item when there is more, and strips sort_key', () => {
    const page = toPage(rows(3), 2);
    expect(page.items).toEqual([{ id: rows(3)[0]!.id, name: 'p0' }, { id: rows(3)[1]!.id, name: 'p1' }]);
    expect(decodeCursor(page.next_cursor!)).toEqual({ key: 'k1', id: rows(3)[1]!.id });
  });

  it('returns no cursor on the last page', () => {
    expect(toPage(rows(2), 2).next_cursor).toBeNull();
    expect(toPage([], 2)).toEqual({ items: [], next_cursor: null });
  });
});

describe('likePattern', () => {
  it('matches wildcards literally', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('Conditions and task filters', () => {
  it('numbers placeholders in order and never inlines values', () => {
    const where = new Conditions().add((p) => `t.org_id = ${p('org-1')}`);
    applyTaskFilters(where, { status: ['todo'], assignee: 'me', q: "x' OR 1=1 --" }, 'user-1');

    expect(where.sql()).toBe(
      "t.org_id = $1 AND t.status = ANY($2::text[]) AND t.assignee_id = $3 AND (t.title ILIKE $4 ESCAPE '\\' OR t.description ILIKE $4 ESCAPE '\\')"
    );
    expect(where.params).toEqual(['org-1', ['todo'], 'user-1', "%x' OR 1=1 --%"]);
  });

  it('filters unassigned tasks without a parameter', () => {
    const where = applyTaskFilters(new Conditions(), { assignee: 'none' }, 'u');
    expect(where.sql()).toBe('t.assignee_id IS NULL');
    expect(where.params).toEqual([]);
  });

  it('is TRUE with no conditions', () => {
    expect(new Conditions().sql()).toBe('TRUE');
  });

  it('sorts tasks without a due date last in both directions', () => {
    expect(taskSortExpression('due_date', 'asc').expr).toContain("'infinity'");
    expect(taskSortExpression('due_date', 'desc').expr).toContain("'-infinity'");
  });
});
