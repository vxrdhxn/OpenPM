import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { addUser, registerOrg, startApp, type Actor, type App } from './harness';

const COLUMNS = ['todo', 'in_progress', 'in_review', 'done'];

/** Phase I: pagination, search and filters on projects, the board and task search (real Postgres). */
describe('pagination and filtering (real Postgres)', () => {
  let app: App;
  let admin: Actor;

  beforeEach(async () => {
    app = await startApp();
    admin = await registerOrg(app);
  });

  afterEach(async () => {
    await app.close();
  });

  const get = (actor: Actor, url: string) => app.inject({ method: 'GET', url, headers: actor.auth });

  /** Insert projects directly (the API's rate limit would make hundreds of requests slow). */
  async function insertProjects(actor: Actor, names: string[], createdAt?: (i: number) => string) {
    const ids: string[] = [];
    for (const [i, name] of names.entries()) {
      const [row] = await db.query<{ id: string }>(
        `INSERT INTO projects (org_id, name, created_by, created_at) VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW())) RETURNING id`,
        [actor.orgId, name, actor.userId, createdAt?.(i) ?? null]
      );
      ids.push(row!.id);
    }
    return ids;
  }

  async function insertTask(actor: Actor, projectId: string, fields: Record<string, unknown> = {}) {
    const [row] = await db.query<{ id: string }>(
      `INSERT INTO tasks (org_id, project_id, title, description, status, priority, assignee_id, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        actor.orgId,
        projectId,
        fields.title ?? 'Task',
        fields.description ?? null,
        fields.status ?? 'todo',
        fields.priority ?? 'medium',
        fields.assignee_id ?? null,
        fields.due_date ?? null,
        actor.userId,
      ]
    );
    return row!.id;
  }

  /** Follow next_cursor to the end and return every item id, in order. */
  async function collect(actor: Actor, url: string, startCursor: string | null = null): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = startCursor;
    for (let guard = 0; guard < 50; guard++) {
      const sep = url.includes('?') ? '&' : '?';
      const res = await get(actor, cursor ? `${url}${sep}cursor=${cursor}` : url);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      ids.push(...body.items.map((i: { id: string }) => i.id));
      cursor = body.next_cursor;
      if (!cursor) return ids;
    }
    throw new Error('pagination did not terminate');
  }

  describe('projects', () => {
    it('pages through every project exactly once, newest first', async () => {
      const ids = await insertProjects(admin, Array.from({ length: 7 }, (_, i) => `P${i}`));

      const seen = await collect(admin, '/api/projects?limit=3');

      expect(seen).toEqual([...ids].reverse());
    });

    it('never skips rows created within the same millisecond', async () => {
      // Microseconds apart: a cursor built from a JS Date (millisecond precision) would skip some.
      const ids = await insertProjects(admin, ['a', 'b', 'c', 'd', 'e'], (i) => `2026-01-01T00:00:00.00010${i}Z`);

      const seen = await collect(admin, '/api/projects?limit=2');

      expect(new Set(seen)).toEqual(new Set(ids));
      expect(seen).toHaveLength(5);
    });

    it('searches by name (wildcards are literal) and filters by status', async () => {
      await insertProjects(admin, ['Website redesign', '50% off campaign', '50 percent', 'Website archive']);
      await db.query("UPDATE projects SET status = 'archived' WHERE org_id = $1 AND name = 'Website archive'", [admin.orgId]);

      const names = async (url: string) => (await get(admin, url)).json().items.map((p: { name: string }) => p.name).sort();

      expect(await names('/api/projects?q=website')).toEqual(['Website archive', 'Website redesign']);
      expect(await names('/api/projects?q=website&status=active')).toEqual(['Website redesign']);
      expect(await names(`/api/projects?q=${encodeURIComponent('50%')}`)).toEqual(['50% off campaign']);
    });

    it('stays inside the caller organization', async () => {
      const other = await registerOrg(app);
      await insertProjects(other, ['Theirs']);
      await insertProjects(admin, ['Ours']);

      const res = await get(admin, '/api/projects?q=Theirs');

      expect(res.json()).toEqual({ items: [], next_cursor: null });
    });

    it.each([
      ['limit=0'],
      ['limit=101'],
      ['limit=abc'],
      ['cursor=not-a-cursor'],
      ['status=deleted'],
      [`q=${'x'.repeat(101)}`],
      ['org_id=00000000-0000-4000-8000-000000000000'],
    ])('rejects ?%s with a 400', async (qs) => {
      const res = await get(admin, `/api/projects?${qs}`);

      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json())).toEqual(['error']);
    });
  });

  describe('board columns', () => {
    it('caps each column, counts every match, and continues a column through GET /api/tasks', async () => {
      const [projectId] = await insertProjects(admin, ['Huge']);
      // 130 to-do tasks (more than one page), 3 done.
      await db.query(
        `INSERT INTO tasks (org_id, project_id, title, status, created_by, created_at)
         SELECT $1, $2, 'T' || g, 'todo', $3, '2026-01-01T00:00:00Z'::timestamptz + (g || ' microseconds')::interval
           FROM generate_series(1, 130) g`,
        [admin.orgId, projectId, admin.userId]
      );
      for (let i = 0; i < 3; i++) await insertTask(admin, projectId!, { status: 'done' });

      const board = (await get(admin, `/api/projects/${projectId}/tasks`)).json();
      expect(board.todo).toHaveLength(100);
      expect(board.done).toHaveLength(3);
      expect(board.totals).toEqual({ todo: 130, in_progress: 0, in_review: 0, done: 3 });
      expect(board.cursors.done).toBeNull();

      const rest = await collect(admin, `/api/tasks?project_id=${projectId}&status=todo&sort=created_at&order=asc&limit=20`, board.cursors.todo);
      const all = [...board.todo.map((t: { id: string }) => t.id), ...rest];
      expect(all).toHaveLength(130);
      expect(new Set(all).size).toBe(130); // no repeats across the board page and the continuation
    });
  });

  describe('board filters', () => {
    it('filters the board by assignee, priority and text, keeping the grouped shape', async () => {
      const [projectId] = await insertProjects(admin, ['Board']);
      const member = await addUser(app, admin.orgId, 'member');
      const mine = await insertTask(admin, projectId!, { title: 'Fix login', assignee_id: admin.userId, priority: 'urgent' });
      await insertTask(admin, projectId!, { title: 'Write docs', assignee_id: member.userId, priority: 'low', status: 'done' });
      const unassigned = await insertTask(admin, projectId!, { title: 'Triage login bugs', priority: 'high' });

      const board = async (qs: string) => {
        const res = await get(admin, `/api/projects/${projectId}/tasks?${qs}`);
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(Object.keys(body).sort()).toEqual(['cursors', 'done', 'in_progress', 'in_review', 'todo', 'totals']);
        return COLUMNS.flatMap((c) => body[c]).map((t: { id: string }) => t.id).sort();
      };

      expect(await board('assignee=me')).toEqual([mine]);
      expect(await board('assignee=none')).toEqual([unassigned]);
      expect(await board('priority=urgent&priority=high')).toEqual([mine, unassigned].sort());
      expect(await board('q=login')).toEqual([mine, unassigned].sort());
    });
  });

  describe('task search', () => {
    it('finds the caller tasks across projects, sorted by due date with undated tasks last', async () => {
      const [p1, p2] = await insertProjects(admin, ['One', 'Two']);
      const late = await insertTask(admin, p1!, { assignee_id: admin.userId, due_date: '2026-12-20T00:00:00Z' });
      const soon = await insertTask(admin, p2!, { assignee_id: admin.userId, due_date: '2026-12-01T00:00:00Z' });
      const undated = await insertTask(admin, p2!, { assignee_id: admin.userId });
      await insertTask(admin, p1!, { due_date: '2026-11-30T00:00:00Z' }); // not mine

      const res = await get(admin, '/api/tasks?assignee=me&sort=due_date&order=asc');

      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items.map((t: { id: string }) => t.id)).toEqual([soon, late, undated]);
      expect(items[0]).toMatchObject({ project_name: 'Two' });
      expect(items[0]).not.toHaveProperty('sort_key');
    });

    it('pages a sort with many equal keys without losing or repeating tasks', async () => {
      const [projectId] = await insertProjects(admin, ['Bulk']);
      const ids: string[] = [];
      for (let i = 0; i < 9; i++) ids.push(await insertTask(admin, projectId!, { priority: i % 2 ? 'high' : 'low' }));

      for (const order of ['asc', 'desc']) {
        const seen = await collect(admin, `/api/tasks?sort=priority&order=${order}&limit=2`);
        expect(seen).toHaveLength(9);
        expect(new Set(seen)).toEqual(new Set(ids));
      }
    });

    it('filters by status, due range and project, and never crosses organizations', async () => {
      const [projectId] = await insertProjects(admin, ['Mine']);
      const inRange = await insertTask(admin, projectId!, { status: 'in_progress', due_date: '2026-12-05T12:00:00Z' });
      await insertTask(admin, projectId!, { status: 'in_progress', due_date: '2027-01-05T12:00:00Z' });
      await insertTask(admin, projectId!, { status: 'done', due_date: '2026-12-05T12:00:00Z' });

      const other = await registerOrg(app);
      const [theirProject] = await insertProjects(other, ['Theirs']);
      await insertTask(other, theirProject!, { status: 'in_progress', due_date: '2026-12-05T12:00:00Z' });

      const res = await get(
        admin,
        '/api/tasks?status=in_progress&due_after=2026-12-01T00:00:00Z&due_before=2027-01-01T00:00:00Z'
      );
      expect(res.json().items.map((t: { id: string }) => t.id)).toEqual([inRange]);

      // Another org's project id simply matches nothing.
      expect((await get(admin, `/api/tasks?project_id=${theirProject}`)).json().items).toEqual([]);
    });

    it.each([['sort=title'], ['assignee=someone'], ['status=blocked'], ['due_before=tomorrow'], ['project_id=1']])(
      'rejects ?%s with a 400',
      async (qs) => {
        expect((await get(admin, `/api/tasks?${qs}`)).statusCode).toBe(400);
      }
    );

    it('requires authentication', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/tasks' })).statusCode).toBe(401);
    });
  });
});
