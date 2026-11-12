import { Pool } from 'pg';
import path from 'path';
import { config } from '../config';
import { migrateUp, migrateDown, migrationStatus } from './migrations';

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

  const pool = new Pool({ connectionString: config.DATABASE_URL });
  const client = await pool.connect();
  try {
    if (command === 'up') {
      await migrateUp(client, dir);
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
