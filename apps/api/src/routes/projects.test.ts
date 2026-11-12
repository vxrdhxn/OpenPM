
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import authPlugin from '../plugins/auth';

vi.mock('../db/client', () => ({
    db: {
        query: vi.fn(),
        getClient: vi.fn(),
    },
}));

vi.mock('../cache/redis', () => ({
    cache: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        publish: vi.fn(),
        subscribe: vi.fn(),
    },
}));

const { getStorage } = vi.hoisted(() => ({ getStorage: vi.fn() }));
vi.mock('../storage', () => ({ getStorage }));

import { db } from '../db/client';
import { cache } from '../cache/redis';
import projectRoutes from './projects';

const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
};

function queryResult(rows: unknown[] = []) {
    return { rows, rowCount: rows.length };
}

describe('Project routes', () => {
    let app: ReturnType<typeof Fastify>;
    let token: string;

    beforeEach(async () => {
        vi.clearAllMocks();

        app = Fastify({
            ajv: {
                customOptions: {
                    removeAdditional: false,
                },
            },
        });
        await app.register(authPlugin);
        await app.register(projectRoutes, { prefix: '/projects' });
        await app.ready();

        token = app.jwt.sign({
            user_id: 'user-1',
            org_id: 'org-1',
            role: 'member',
        });

        vi.mocked(db.getClient).mockResolvedValue(mockClient as never);
        mockClient.release.mockReset();
    });

    afterEach(async () => {
        await app.close();
    });

    function patch(payload: Record<string, unknown>) {
        return app.inject({
            method: 'PATCH',
            url: '/projects/project-1',
            headers: { authorization: `Bearer ${token}` },
            payload,
        });
    }

    it('rejects an empty PATCH body', async () => {
        const response = await patch({});

        expect(response.statusCode).toBe(400);
        expect(db.getClient).not.toHaveBeenCalled();
    });


    it('rejects unsupported project fields', async () => {
        const response = await patch({
            name: 'Updated project',
            org_id: 'another-org',
        });

        expect(response.statusCode).toBe(400);
        expect(db.getClient).not.toHaveBeenCalled();
    });

    it('rejects a status outside the allowed enum', async () => {
        const response = await patch({ status: 'deleted' });

        expect(response.statusCode).toBe(400);
        expect(db.getClient).not.toHaveBeenCalled();
    });

    it('returns 404 when the project is not in the authenticated organization', async () => {
        mockClient.query
            .mockResolvedValueOnce(queryResult()) // BEGIN
            .mockResolvedValueOnce(queryResult()); // Organization-scoped lookup

        const response = await patch({ name: 'Updated project' });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ error: 'Project not found' });
        expect(mockClient.query).toHaveBeenCalledWith(
            'SELECT id FROM projects WHERE id = $1 AND org_id = $2',
            ['project-1', 'org-1'],
        );
        expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalledOnce();
        expect(cache.del).not.toHaveBeenCalled();
    });

    it('updates an authorized project and invalidates its organization cache', async () => {
        const updatedProject = {
            id: 'project-1',
            org_id: 'org-1',
            name: 'Updated project',
            description: 'Updated description',
            status: 'active',
        };

        mockClient.query
            .mockResolvedValueOnce(queryResult()) // BEGIN
            .mockResolvedValueOnce(queryResult([{ id: 'project-1' }]))
            .mockResolvedValueOnce(queryResult([updatedProject])) // UPDATE
            .mockResolvedValueOnce(queryResult()) // Activity log
            .mockResolvedValueOnce(queryResult()); // COMMIT

        const response = await patch({
            name: 'Updated project',
            description: 'Updated description',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(updatedProject);

        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE projects'),
            ['Updated project', 'Updated description', 'project-1', 'org-1'],
        );

        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO activity_log'),
            expect.any(Array),
        );

        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        expect(cache.del).toHaveBeenCalledWith('org:org-1:projects');
        expect(mockClient.release).toHaveBeenCalledOnce();
    });

    describe('DELETE', () => {
        const storage = { delete: vi.fn() };
        const sqls = () => mockClient.query.mock.calls.map((c) => String(c[0]));

        function remove(role = 'admin') {
            const adminToken = app.jwt.sign({ user_id: 'user-1', org_id: 'org-1', role });
            return app.inject({
                method: 'DELETE',
                url: '/projects/project-1',
                headers: { authorization: `Bearer ${adminToken}` },
            });
        }

        function scenario({ keys = [] as string[], projectExists = true } = {}) {
            mockClient.query.mockReset();
            mockClient.query.mockImplementation(async (sql: string) => {
                if (sql.startsWith('DELETE FROM task_attachments')) {
                    return queryResult(keys.map((storage_key) => ({ storage_key })));
                }
                if (sql.startsWith('DELETE FROM projects')) {
                    return queryResult(projectExists ? [{ id: 'project-1' }] : []);
                }
                return queryResult();
            });
        }

        beforeEach(() => {
            storage.delete.mockReset().mockResolvedValue(undefined);
            getStorage.mockReturnValue(storage);
        });

        it('removes the files of every task in the project, after commit', async () => {
            scenario({ keys: ['org/org-1/tasks/a/k1', 'org/org-1/tasks/b/k2'] });

            const response = await remove();

            expect(response.statusCode).toBe(204);
            expect(storage.delete).toHaveBeenCalledTimes(2);
            expect(storage.delete).toHaveBeenCalledWith('org/org-1/tasks/a/k1');
            expect(storage.delete).toHaveBeenCalledWith('org/org-1/tasks/b/k2');
            expect(cache.del).toHaveBeenCalledWith('org:org-1:projects');
        });

        it('collects keys inside the transaction, scoped to the project and org, before deleting the project', async () => {
            scenario({ keys: ['k1'] });

            await remove();

            const order = sqls();
            const attachmentsAt = order.findIndex((s) => s.startsWith('DELETE FROM task_attachments'));
            const projectAt = order.findIndex((s) => s.startsWith('DELETE FROM projects'));
            expect(attachmentsAt).toBeGreaterThan(order.indexOf('BEGIN'));
            expect(attachmentsAt).toBeLessThan(projectAt);
            expect(projectAt).toBeLessThan(order.indexOf('COMMIT'));

            const call = mockClient.query.mock.calls[attachmentsAt]!;
            expect(String(call[0])).toContain('RETURNING a.storage_key');
            expect(String(call[0])).toContain('t.project_id = $1');
            expect(call[1]).toEqual(['project-1', 'org-1']);
        });

        it('returns 404, rolls back and keeps the files when the project is not in the organization', async () => {
            scenario({ keys: ['k1'], projectExists: false });

            const response = await remove();

            expect(response.statusCode).toBe(404);
            expect(sqls()).toContain('ROLLBACK');
            expect(storage.delete).not.toHaveBeenCalled();
            expect(cache.del).not.toHaveBeenCalled();
        });

        it('still succeeds when storage fails', async () => {
            scenario({ keys: ['k1', 'k2'] });
            storage.delete.mockRejectedValue(new Error('storage down'));

            const response = await remove();

            expect(response.statusCode).toBe(204);
            expect(storage.delete).toHaveBeenCalledTimes(2);
        });

        it('works when attachment storage is not configured', async () => {
            getStorage.mockReturnValue(null);
            scenario({ keys: ['k1'] });

            expect((await remove()).statusCode).toBe(204);
        });

        it('stays admin-only', async () => {
            scenario();

            const response = await remove('member');

            expect(response.statusCode).toBe(403);
            expect(db.getClient).not.toHaveBeenCalled();
        });
    });
});
