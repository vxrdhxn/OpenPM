import { FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { hashPassword } from '../security/passwords';
import { db } from '../db/client';
import { withTransaction } from '../db/transaction';
import { generateToken, hashToken, TOKEN_PATTERN } from '../security/tokens';
import { issueSession } from '../plugins/session';
import { enqueue } from '../jobs/enqueue';

const INVITE_TTL_DAYS = 7;

// Shape of an invite in every response. Never includes the token or its hash.
const INVITE_COLUMNS = 'id, email, role, expires_at, created_at';

const tokenProperty = { type: 'string', pattern: TOKEN_PATTERN } as const;

async function logInviteActivity(
  client: PoolClient,
  orgId: string,
  userId: string,
  inviteId: string,
  action: 'created' | 'revoked' | 'accepted',
  metadata: Record<string, unknown> = {}
) {
  await client.query(
    'INSERT INTO activity_log (org_id, user_id, entity_type, entity_id, action, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [orgId, userId, 'invite', inviteId, action, JSON.stringify(metadata)]
  );
}

const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  // ── Admin routes (authenticated) ─────────────────────────────────────────────
  await fastify.register(async (admin) => {
    admin.addHook('preValidation', admin.authenticate);

    // POST / — invite someone to the caller's organization and email them a link.
    admin.post('/', {
      preHandler: admin.requireRole('admin'),
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['member', 'admin'], default: 'member' }
          },
          additionalProperties: false
        }
      }
    }, async (request, reply) => {
      const { org_id, user_id } = request.user;
      const { role = 'member' } = request.body as { email: string; role?: string };
      const email = (request.body as { email: string }).email.toLowerCase().trim();

      const { token, tokenHash } = generateToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

      try {
        const invite = await withTransaction(async (client) => {
          const member = await client.query('SELECT id FROM users WHERE email = $1 AND org_id = $2', [email, org_id]);
          if (member.rows.length > 0) {
            throw new Error('ALREADY_MEMBER');
          }

          // Re-inviting the same address replaces the old link: its token hash is overwritten.
          const res = await client.query(
            `INSERT INTO organization_invites (org_id, email, token_hash, role, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (org_id, email) DO UPDATE SET token_hash = $3, role = $4, expires_at = $5
             RETURNING ${INVITE_COLUMNS}`,
            [org_id, email, tokenHash, role, expiresAt]
          );
          const created = res.rows[0];

          await logInviteActivity(client, org_id, user_id, created.id, 'created', { role });
          return created;
        });

        // The raw token goes only into the job that emails it. The job is removed from Redis once it
        // completes; a failed one is kept for a day for debugging. Never logged (see worker).
        // Best effort (jobs/enqueue.ts): if it fails, the invite exists and can be re-sent.
        await enqueue(
          'invite_created',
          { invite_id: invite.id, org_id, token, request_id: request.id },
          { removeOnComplete: true, removeOnFail: { age: 24 * 60 * 60 } },
          request.log
        );

        return reply.code(201).send(invite);
      } catch (err) {
        if (err instanceof Error && err.message === 'ALREADY_MEMBER') {
          return reply.code(409).send({ error: 'This person is already a member of your organization' });
        }
        throw err;
      }
    });

    // GET / — pending invites for the caller's organization.
    admin.get('/', {
      preHandler: admin.requireRole('admin')
    }, async (request, reply) => {
      const { org_id } = request.user;

      const res = await db.query(
        `SELECT ${INVITE_COLUMNS} FROM organization_invites WHERE org_id = $1 ORDER BY created_at DESC`,
        [org_id]
      );

      return reply.send(res);
    });

    // DELETE /:id — revoke an invite.
    admin.delete('/:id', {
      preHandler: admin.requireRole('admin'),
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } }
        }
      }
    }, async (request, reply) => {
      const { org_id, user_id } = request.user;
      const { id } = request.params as { id: string };

      try {
        await withTransaction(async (client) => {
          const res = await client.query(
            'DELETE FROM organization_invites WHERE id = $1 AND org_id = $2 RETURNING id',
            [id, org_id]
          );
          if (res.rows.length === 0) {
            throw new Error('NOT_FOUND');
          }
          await logInviteActivity(client, org_id, user_id, id, 'revoked');
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'NOT_FOUND') {
          return reply.code(404).send({ error: 'Invite not found' });
        }
        throw err;
      }

      return reply.code(204).send();
    });
  });

  // ── Public routes (the invitee has no account yet) ───────────────────────────
  // The token is sent in the body rather than the URL, so it never lands in access logs.

  // POST /lookup — what the invite is for, so the accept page can show it.
  fastify.post('/lookup', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: tokenProperty },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { token } = request.body as { token: string };

    const res = await db.query(
      `SELECT i.email, i.role, i.expires_at, o.name AS org_name
         FROM organization_invites i
         JOIN organizations o ON o.id = i.org_id
        WHERE i.token_hash = $1 AND i.expires_at > NOW()`,
      [hashToken(token)]
    );

    if (res.length === 0) {
      return reply.code(404).send({ error: 'Invite not found or expired' });
    }

    return reply.send(res[0]);
  });

  // POST /accept — create the invitee's account in the inviting organization and sign them in.
  fastify.post('/accept', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object',
        required: ['token', 'name', 'password'],
        properties: {
          token: tokenProperty,
          name: { type: 'string', minLength: 2 },
          password: { type: 'string', minLength: 8 }
        },
        // The organization, role and email all come from the invite, never from the request.
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { token, name, password } = request.body as { token: string; name: string; password: string };

    try {
      const user = await withTransaction(async (client) => {
        // FOR UPDATE: two simultaneous accepts of the same link can't both create an account.
        const inviteRes = await client.query(
          `SELECT id, org_id, email, role
             FROM organization_invites
            WHERE token_hash = $1 AND expires_at > NOW()
            FOR UPDATE`,
          [hashToken(token)]
        );
        if (inviteRes.rows.length === 0) {
          throw new Error('INVALID_INVITE');
        }
        const invite = inviteRes.rows[0];

        // Each user belongs to exactly one organization (users.email is unique).
        const existing = await client.query('SELECT id FROM users WHERE email = $1', [invite.email]);
        if (existing.rows.length > 0) {
          throw new Error('EMAIL_TAKEN');
        }

        const passwordHash = await hashPassword(password);
        const userRes = await client.query(
          'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [invite.org_id, invite.email, passwordHash, name, invite.role]
        );
        const userId = userRes.rows[0].id;

        await client.query('DELETE FROM organization_invites WHERE id = $1', [invite.id]);
        await logInviteActivity(client, invite.org_id, userId, invite.id, 'accepted', { role: invite.role });

        return { user_id: userId as string, org_id: invite.org_id as string, role: invite.role as string, tv: 0 };
      });

      const sessionToken = issueSession(fastify, reply, user);
      return reply.code(201).send({ token: sessionToken });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'INVALID_INVITE') {
        return reply.code(404).send({ error: 'Invite not found or expired' });
      }
      // 23505: the email was registered between our check and the insert.
      if (message === 'EMAIL_TAKEN' || (err as { code?: string })?.code === '23505') {
        return reply.code(409).send({ error: 'An account with this email already exists. Sign in instead.' });
      }
      throw err;
    }
  });
};

export default inviteRoutes;
