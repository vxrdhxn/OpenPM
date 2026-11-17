import path from 'path';
import { Client } from 'pg';
import crypto from 'crypto';
import { listMigrations, migrateDown, migrateUp } from '../../db/migrations';
import { ensureAppRole } from '../../db/appRole';

/**
 * Creates a throwaway database for the integration run and migrates it. Every migration is applied,
 * rolled back to an empty schema and applied again, so each run also proves that all up and down
 * migrations work on real Postgres. The database is dropped afterwards.
 */
export default async function setup() {
  const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://openpm:openpm@localhost:5432/postgres';
  const dbName = `openpm_it_${Date.now()}_${process.pid}`;

  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Integration tests need Postgres at TEST_DATABASE_URL (${adminUrl.replace(/\/\/[^@]*@/, '//***@')}). ` +
        `Start one with "docker compose up -d postgres". Cause: ${(err as Error).message}`
    );
  }
  await admin.query(`CREATE DATABASE ${dbName}`);

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;

  const dir = path.join(__dirname, '../../db/migrations');
  const appRole = { user: `${dbName}_app`, password: crypto.randomBytes(16).toString('hex') };
  const quiet = () => {};
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await migrateUp(client, dir, quiet);
    await migrateDown(client, dir, listMigrations(dir).length, quiet);
    const left = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'"
    );
    if (left.rows.length > 0) {
      throw new Error(`Rolling back every migration left tables behind: ${left.rows.map((r) => r.table_name).join(', ')}`);
    }
    await migrateUp(client, dir, quiet);
    // The tests connect as the app does in production: an unprivileged user that can change rows but
    // not the schema (db/appRole.ts). So every route is also tested with exactly those rights.
    await ensureAppRole(client, appRole, decodeURIComponent(url.username));
  } finally {
    await client.end();
  }

  const appUrl = new URL(url.toString());
  appUrl.username = appRole.user;
  appUrl.password = appRole.password;

  // Inherited by the test workers, which read it through src/config.ts. The owner's URL is there for
  // the tests that check what the app user may not do.
  process.env.DATABASE_URL = appUrl.toString();
  process.env.TEST_OWNER_DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'test';

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${appRole.user}`);
    await admin.end();
  };
}
