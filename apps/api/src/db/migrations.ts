import fs from 'fs';
import path from 'path';

/**
 * Migration engine.
 *
 * Layout: `NNN_name.sql` is the "up" migration, `NNN_name.down.sql` its rollback.
 * Applied migrations are recorded in `schema_migrations` by their up-file name
 * (unchanged from the original runner, so existing databases keep working).
 */

export interface Migration {
  version: string; // up-file name, e.g. 001_organizations.sql
  upPath: string;
  downPath: string | null;
}

/** Minimal surface of pg.PoolClient we depend on (eases testing). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

// Arbitrary constant; serialises concurrent runners (e.g. several pods starting).
const LOCK_ID = 727_001;

const DOWN_SUFFIX = '.down.sql';

export function listMigrations(dir: string): Migration[] {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith(DOWN_SUFFIX))
    .sort()
    .map((version) => {
      const down = path.join(dir, version.replace(/\.sql$/, DOWN_SUFFIX));
      return {
        version,
        upPath: path.join(dir, version),
        downPath: fs.existsSync(down) ? down : null,
      };
    });
}

async function ensureTable(client: Queryable): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function appliedVersions(client: Queryable): Promise<string[]> {
  const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version');
  return rows.map((r) => r.version as string);
}

async function withLock<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  try {
    return await fn();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  }
}

async function runInTransaction(client: Queryable, work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/** Apply all pending migrations in order. Each runs in its own transaction. */
export async function migrateUp(
  client: Queryable,
  dir: string,
  log: (msg: string) => void = console.log
): Promise<string[]> {
  return withLock(client, async () => {
    await ensureTable(client);
    const applied = new Set(await appliedVersions(client));
    const ran: string[] = [];

    for (const m of listMigrations(dir)) {
      if (applied.has(m.version)) continue;

      log(`Applying: ${m.version}`);
      const sql = fs.readFileSync(m.upPath, 'utf8');
      await runInTransaction(client, async () => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
      });
      ran.push(m.version);
    }

    log(ran.length ? `Applied ${ran.length} migration(s).` : 'Database is up to date.');
    return ran;
  });
}

/**
 * Roll back the most recently applied `steps` migrations (newest first).
 * Fails before changing anything if any targeted migration has no down file.
 */
export async function migrateDown(
  client: Queryable,
  dir: string,
  steps = 1,
  log: (msg: string) => void = console.log
): Promise<string[]> {
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`steps must be a positive integer, got ${steps}`);
  }

  return withLock(client, async () => {
    await ensureTable(client);
    const applied = await appliedVersions(client);
    const known = new Map(listMigrations(dir).map((m) => [m.version, m]));

    const targets = applied.slice(-steps).reverse();
    for (const version of targets) {
      const m = known.get(version);
      if (!m) throw new Error(`Cannot roll back ${version}: migration file not found`);
      if (!m.downPath) throw new Error(`Cannot roll back ${version}: no .down.sql file`);
    }

    for (const version of targets) {
      log(`Rolling back: ${version}`);
      const sql = fs.readFileSync(known.get(version)!.downPath!, 'utf8');
      await runInTransaction(client, async () => {
        await client.query(sql);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      });
    }

    log(targets.length ? `Rolled back ${targets.length} migration(s).` : 'Nothing to roll back.');
    return targets;
  });
}

export interface MigrationStatus {
  version: string;
  applied: boolean;
  reversible: boolean;
}

export async function migrationStatus(client: Queryable, dir: string): Promise<MigrationStatus[]> {
  await ensureTable(client);
  const applied = new Set(await appliedVersions(client));
  return listMigrations(dir).map((m) => ({
    version: m.version,
    applied: applied.has(m.version),
    reversible: m.downPath !== null,
  }));
}
