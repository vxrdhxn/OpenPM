import { escapeIdentifier, escapeLiteral } from 'pg';
import type { Queryable } from './queryable';

/**
 * Least-privilege database user (docs/database-access.md).
 *
 * Migrations run as the database owner (DATABASE_MIGRATION_URL). The API and worker connect as a
 * separate app user (DATABASE_URL) that can read and write rows but not change the schema: an SQL
 * injection or a compromised API pod cannot drop tables, alter them, create functions or rewrite the
 * migration history, and cannot edit the security audit log, only add to it and prune it.
 *
 * Called after every `migrate up`, so tables added by new migrations are granted too.
 */

export interface AppRole {
  user: string;
  password: string;
}

/** The user and password of a postgres:// URL, or null when it has none. */
export function appRoleFromUrl(url: string): AppRole | null {
  const u = new URL(url);
  if (!u.username) return null;
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

/** The statements that create (if missing) and grant the app role. Separate so tests can read them. */
export function appRoleStatements(role: AppRole, exists: boolean, database: string): string[] {
  const r = escapeIdentifier(role.user);
  return [
    ...(exists ? [] : [`CREATE ROLE ${r} LOGIN PASSWORD ${escapeLiteral(role.password)}`]),
    `GRANT CONNECT ON DATABASE ${escapeIdentifier(database)} TO ${r}`,
    `GRANT USAGE ON SCHEMA public TO ${r}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`,
    // The migration history: readable (health checks, `migrate status`), never writable by the app.
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM ${r}`,
    // The audit log is append-only for the app; DELETE stays for the retention sweep.
    `REVOKE UPDATE, TRUNCATE ON audit_log FROM ${r}`,
  ];
}

/**
 * Make sure the app role exists and has exactly the rights above. Creating it needs CREATEROLE (the
 * Compose and in-chart Postgres owner is a superuser); on a managed database where the owner cannot
 * create roles, create the user yourself first and this only grants.
 */
export async function ensureAppRole(client: Queryable, role: AppRole, owner: string): Promise<{ created: boolean }> {
  if (role.user === owner) {
    throw new Error('DATABASE_URL and DATABASE_MIGRATION_URL use the same user: the app user must be a different, unprivileged one.');
  }
  const found = await client.query(`SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = ${escapeLiteral(role.user)}`);
  const existing = found.rows[0];
  if (existing && (existing.rolsuper || existing.rolcreaterole || existing.rolcreatedb)) {
    throw new Error(`The app user "${role.user}" is a superuser or can create roles or databases. Use an ordinary login role.`);
  }
  if (!existing && !role.password) {
    throw new Error(`The app user "${role.user}" does not exist and DATABASE_URL has no password to create it with.`);
  }
  const db = (await client.query('SELECT current_database() AS name')).rows[0]!.name as string;
  for (const sql of appRoleStatements(role, !!existing, db)) await client.query(sql);
  // Nobody but the owner may create objects in the schema. The default since Postgres 15; older
  // databases let every user create tables in public. Only the schema's owner can change it, so a
  // migration user that does not own the schema leaves it as it is.
  try {
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  } catch {
    /* not the schema owner */
  }
  return { created: !existing };
}
