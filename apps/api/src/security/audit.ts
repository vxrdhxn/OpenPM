import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { db } from '../db/client';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Security audit log (docs/audit-log.md): who signed in, who failed to, and who changed what someone
 * else may do or see. Admins and owners read it at GET /api/audit.
 *
 * Every action is listed here, so the admin view and the docs can name each one, and a typo is a
 * compile error rather than a row nobody can filter for.
 */
export const AUDIT_ACTIONS = [
  'auth.registered', // created the workspace (and its first account)
  'auth.login',
  'auth.login_failed', // wrong password for an existing, active account
  'auth.logout',
  'auth.password_changed',
  'auth.password_reset_requested',
  'auth.password_reset',
  'member.role_changed',
  'member.removed',
  'member.left',
  'member.ownership_transferred',
  'invite.created',
  'invite.revoked',
  'invite.accepted',
  'invite.declined',
  'organization.renamed',
  'project.visibility_changed',
  'project.member_added',
  'project.member_removed',
  'project.deleted',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEvent {
  orgId: string;
  /** Who did it; null when nobody is signed in (e.g. a password reset by link). */
  actorId: string | null;
  action: AuditAction;
  targetType?: 'user' | 'invite' | 'organization' | 'project';
  targetId?: string | null;
  /** Never secrets: no passwords, tokens or token hashes. */
  metadata?: Record<string, unknown>;
}

/** Anything with pg's `query(text, values)`: a transaction client, or the pool (via `db`). */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/** Where a request came from. `request.ip` honours TRUST_PROXY, so behind the Ingress it is the client. */
export interface RequestOrigin {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export function originOf(request: Pick<FastifyRequest, 'ip' | 'headers' | 'id'>): RequestOrigin {
  const ua = request.headers['user-agent'];
  return { ip: request.ip, userAgent: typeof ua === 'string' ? ua : null, requestId: request.id };
}

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/**
 * Record one event. Inside a transaction, pass its client, so the entry commits or rolls back with
 * the change it describes. Throws on failure, like any other statement in that transaction.
 */
export async function audit(q: Queryable, origin: RequestOrigin | null, event: AuditEvent): Promise<void> {
  await q.query(
    `INSERT INTO audit_log (org_id, actor_id, action, target_type, target_id, ip, user_agent, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      event.orgId,
      event.actorId,
      event.action,
      event.targetType ?? null,
      event.targetId ?? null,
      clip(origin?.ip, 64),
      clip(origin?.userAgent, 256),
      clip(origin?.requestId, 128),
      JSON.stringify(event.metadata ?? {}),
    ]
  );
}

/**
 * For events with nothing to roll back (sign-in, sign-out): a failed write is logged, with the event,
 * and does not fail the request. Signing in must not depend on the audit table.
 */
export async function auditBestEffort(origin: RequestOrigin | null, event: AuditEvent, log: FastifyBaseLogger = logger): Promise<void> {
  try {
    await audit({ query: (text, values) => db.query(text, values as unknown[]) }, origin, event);
  } catch (err) {
    log.error({ err, audit_action: event.action, org_id: event.orgId }, 'Could not write the audit log');
  }
}

/** Delete entries older than AUDIT_RETENTION_DAYS, in batches so no single statement runs long. */
export async function pruneAuditLog(retentionDays = config.AUDIT_RETENTION_DAYS, batch = 5000): Promise<number> {
  let total = 0;
  for (;;) {
    const rows = await db.query<{ n: string }>(
      `WITH old AS (
         SELECT id FROM audit_log WHERE created_at < NOW() - make_interval(days => $1) LIMIT $2
       ), gone AS (
         DELETE FROM audit_log WHERE id IN (SELECT id FROM old) RETURNING 1
       )
       SELECT count(*)::text AS n FROM gone`,
      [retentionDays, batch]
    );
    const n = Number(rows[0]?.n ?? 0);
    total += n;
    if (n < batch) return total;
  }
}

/**
 * Prune once soon after start, then every `everyMs`. Every API pod runs this; the DELETE is
 * idempotent, so running it in several places at once only repeats work. Returns a stop function.
 */
export function startAuditRetention(log: FastifyBaseLogger, everyMs = 6 * 60 * 60 * 1000): () => void {
  const run = () =>
    pruneAuditLog().then(
      (n) => {
        if (n > 0) log.info({ deleted: n, retention_days: config.AUDIT_RETENTION_DAYS }, 'Pruned the audit log');
      },
      (err) => log.warn({ err }, 'Audit log pruning failed; will retry')
    );
  // A random delay, so pods started together do not all prune at the same moment.
  const first = setTimeout(run, 60_000 + Math.floor(Math.random() * 60_000));
  const every = setInterval(run, everyMs);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
