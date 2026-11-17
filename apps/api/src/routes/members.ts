import { FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { cache } from '../cache/redis';
import { clearSessionCookie } from '../plugins/session';
import { checkMemberChange, DENIAL_MESSAGES, isManager, ROLES } from '../security/memberPolicy';

/** Shape of a member in every response. Never includes the password hash or token version. */
const MEMBER_COLUMNS = 'id, name, email, role, created_at';

/** Marks a removed account's password: never a valid bcrypt hash, so it can never match. */
const REMOVED_PASSWORD = '!removed';

class MemberError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const NOT_FOUND = () => new MemberError(404, 'Member not found');
const LAST_MANAGER = () =>
  new MemberError(409, 'The organization needs at least one admin. Make another member an admin first.');
const LAST_OWNER = () =>
  new MemberError(409, 'The organization needs an owner. Transfer ownership to another member first.');

/**
 * Serializes membership changes within one organization, so two concurrent changes cannot both pass
 * the "at least one admin remains" check (e.g. the last two admins demoting each other at once).
 */
async function lockOrganization(client: PoolClient, orgId: string) {
  await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
}

async function findActiveMember(client: PoolClient, orgId: string, userId: string) {
  const res = await client.query<{ id: string; name: string; role: string }>(
    'SELECT id, name, role FROM users WHERE id = $1 AND org_id = $2 AND deactivated_at IS NULL FOR UPDATE',
    [userId, orgId]
  );
  return res.rows[0];
}

/** Throws if `userId` is the organization's last admin/owner. */
async function assertAnotherManagerRemains(client: PoolClient, orgId: string, userId: string) {
  const res = await client.query(
    `SELECT 1 FROM users
      WHERE org_id = $1 AND id <> $2 AND deactivated_at IS NULL AND role IN ('owner', 'admin')
      LIMIT 1`,
    [orgId, userId]
  );
  if (res.rows.length === 0) throw LAST_MANAGER();
}

/** Throws if `userId` is the organization's last owner (only owners can transfer or delete it). */
async function assertAnotherOwnerRemains(client: PoolClient, orgId: string, userId: string) {
  const res = await client.query(
    `SELECT 1 FROM users
      WHERE org_id = $1 AND id <> $2 AND deactivated_at IS NULL AND role = 'owner'
      LIMIT 1`,
    [orgId, userId]
  );
  if (res.rows.length === 0) throw LAST_OWNER();
}

/** Checks that losing `member` as a manager/owner (demotion, removal or leaving) leaves the org run. */
async function assertStillRun(client: PoolClient, orgId: string, member: { id: string; role: string }, newRole?: string) {
  if (member.role === 'owner' && newRole !== 'owner') await assertAnotherOwnerRemains(client, orgId, member.id);
  if (isManager(member.role) && !(newRole && isManager(newRole))) await assertAnotherManagerRemains(client, orgId, member.id);
}

async function logMemberActivity(
  client: PoolClient,
  orgId: string,
  actorId: string,
  targetId: string,
  action: 'role_changed' | 'removed' | 'left' | 'ownership_transferred',
  metadata: Record<string, unknown>
) {
  await client.query(
    'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, actorId, 'user', targetId, action, JSON.stringify(metadata)]
  );
}

/**
 * Deactivate a member (see migration 013): tombstone the row, end their sessions, drop their reset
 * links and unassign their tasks. Returns the projects whose boards changed.
 */
async function deactivate(client: PoolClient, orgId: string, userId: string): Promise<string[]> {
  await client.query(
    `UPDATE users
        SET deactivated_at = NOW(),
            email = 'removed-' || id || '@removed.invalid',
            password_hash = $3,
            token_version = token_version + 1
      WHERE id = $1 AND org_id = $2`,
    [userId, orgId, REMOVED_PASSWORD]
  );
  await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  const unassigned = await client.query<{ project_id: string }>(
    'UPDATE tasks SET assignee_id = NULL, updated_at = NOW() WHERE assignee_id = $1 AND org_id = $2 RETURNING project_id',
    [userId, orgId]
  );
  return [...new Set(unassigned.rows.map((r) => r.project_id))];
}

async function invalidateBoards(orgId: string, projectIds: string[]) {
  await Promise.all(projectIds.map((id) => cache.del(`org:${orgId}:project:${id}:tasks`)));
}

/**
 * Organization members. There is one organization per user (users.org_id), so "member" = an active
 * user row of the caller's organization. Every query is scoped to the JWT org.
 */
const memberRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preValidation', fastify.authenticate);

  // GET / — everyone in the organization can see who is in it.
  fastify.get('/', { preHandler: fastify.requireRole('viewer') }, async (request) => {
    return db.query(
      `SELECT ${MEMBER_COLUMNS} FROM users WHERE org_id = $1 AND deactivated_at IS NULL ORDER BY created_at ASC, id ASC`,
      [request.user.org_id]
    );
  });

  // PATCH /:id — change a member's role.
  fastify.patch('/:id', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: { role: { type: 'string', enum: [...ROLES] } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { org_id, user_id, role: actorRole } = request.user;
    const { id } = request.params as { id: string };
    const { role } = request.body as { role: string };

    try {
      const member = await withTransaction(async (client) => {
        await lockOrganization(client, org_id);
        const target = await findActiveMember(client, org_id, id);
        if (!target) throw NOT_FOUND();

        const denial = checkMemberChange({ id: user_id, role: actorRole }, target, role);
        if (denial) throw new MemberError(403, DENIAL_MESSAGES[denial]);

        if (target.role === role) return target;
        await assertStillRun(client, org_id, target, role);

        // No session revocation needed: every request reads the role from the database (plugins/auth.ts).
        const res = await client.query(
          `UPDATE users SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING ${MEMBER_COLUMNS}`,
          [role, id, org_id]
        );
        await logMemberActivity(client, org_id, user_id, id, 'role_changed', { from: target.role, to: role });
        return res.rows[0];
      });
      return reply.send(member);
    } catch (err) {
      if (err instanceof MemberError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // DELETE /:id — remove a member from the organization.
  fastify.delete('/:id', { preHandler: fastify.requireRole('admin') }, async (request, reply) => {
    const { org_id, user_id, role: actorRole } = request.user;
    const { id } = request.params as { id: string };

    try {
      const boards = await withTransaction(async (client) => {
        await lockOrganization(client, org_id);
        const target = await findActiveMember(client, org_id, id);
        if (!target) throw NOT_FOUND();

        const denial = checkMemberChange({ id: user_id, role: actorRole }, target);
        if (denial) throw new MemberError(403, DENIAL_MESSAGES[denial]);

        await assertStillRun(client, org_id, target);

        const changed = await deactivate(client, org_id, id);
        await logMemberActivity(client, org_id, user_id, id, 'removed', { role: target.role, name: target.name });
        return changed;
      });

      await invalidateBoards(org_id, boards);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof MemberError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /:id/transfer-ownership — make another member the owner and step down to admin, in one
  // step, so the organization is never without an owner and never has one by accident.
  fastify.post('/:id/transfer-ownership', { preHandler: fastify.requireRole('owner') }, async (request, reply) => {
    const { org_id, user_id } = request.user;
    const { id } = request.params as { id: string };

    try {
      const result = await withTransaction(async (client) => {
        await lockOrganization(client, org_id);
        if (id === user_id) throw new MemberError(400, 'You already own this organization.');
        const me = await findActiveMember(client, org_id, user_id);
        if (!me || me.role !== 'owner') throw new MemberError(403, 'Only an owner can transfer ownership.');
        const target = await findActiveMember(client, org_id, id);
        if (!target) throw NOT_FOUND();

        const res = await client.query(
          `UPDATE users SET role = CASE WHEN id = $1 THEN 'owner' ELSE 'admin' END
            WHERE org_id = $3 AND id IN ($1, $2)
            RETURNING ${MEMBER_COLUMNS}`,
          [id, user_id, org_id]
        );
        await logMemberActivity(client, org_id, user_id, id, 'ownership_transferred', { from_role: target.role });
        return res.rows;
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof MemberError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  // POST /leave — leave the organization yourself (any role, except the last admin).
  fastify.post('/leave', { preHandler: fastify.requireRole('viewer') }, async (request, reply) => {
    const { org_id, user_id } = request.user;

    try {
      const boards = await withTransaction(async (client) => {
        await lockOrganization(client, org_id);
        const me = await findActiveMember(client, org_id, user_id);
        if (!me) throw NOT_FOUND();

        await assertStillRun(client, org_id, me);

        const changed = await deactivate(client, org_id, user_id);
        await logMemberActivity(client, org_id, user_id, user_id, 'left', { role: me.role });
        return changed;
      });

      await invalidateBoards(org_id, boards);
      clearSessionCookie(reply);
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof MemberError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
};

export default memberRoutes;
