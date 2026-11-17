import { Pool } from 'pg';
import path from 'path';
import { config } from '../config';
import { migrateUp, migrateDown, migrationStatus } from './migrations';
import { appRoleFromUrl, ensureAppRole } from './appRole';

const USAGE = `Usage: migrate [up | down [steps] | status]
  up            apply all pending migrations (default)
  down [steps]  roll back the last N migrations (default 1)
  status        list migrations and whether they are applied`;

async function main() {
  const [command = 'up', arg] = process.argv.slice(2);
  const dir = path.join(__dirname, 'migrations');

  if (!['up', 'down', 'status'].includes(command)) {
    console.error(USAGE);
    process.exit(2);
  }

  // Migrations run as the schema's owner. With DATABASE_MIGRATION_URL set, DATABASE_URL is the app's
  // own unprivileged user, created and granted below (db/appRole.ts, docs/database-access.md).
  const ownerUrl = config.DATABASE_MIGRATION_URL ?? config.DATABASE_URL;
  const pool = new Pool({ connectionString: ownerUrl });
  const client = await pool.connect();
  try {
    if (command === 'up') {
      await migrateUp(client, dir);
      if (config.DATABASE_MIGRATION_URL) {
        const role = appRoleFromUrl(config.DATABASE_URL);
        if (!role) throw new Error('DATABASE_URL names no user for the app to connect as.');
        const { created } = await ensureAppRole(client, role, appRoleFromUrl(ownerUrl)?.user ?? '');
        console.log(`${created ? 'Created' : 'Checked'} the app database user "${role.user}": rows only, no schema changes.`);
      }
    } else if (command === 'down') {
      await migrateDown(client, dir, arg === undefined ? 1 : Number(arg));
    } else {
      for (const s of await migrationStatus(client, dir)) {
        console.log(`${s.applied ? '[x]' : '[ ]'} ${s.version}${s.reversible ? '' : '  (no rollback)'}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
