import path from 'path';
import { Client } from 'pg';
import { listMigrations, migrateDown, migrateUp } from '../../db/migrations';

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
  } finally {
    await client.end();
  }

  // Inherited by the test workers, which read it through src/config.ts.
  process.env.DATABASE_URL = url.toString();
  process.env.NODE_ENV = 'test';

  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  };
}
