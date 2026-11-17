import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { db } from '../../db/client';
import { appRoleStatements, ensureAppRole } from '../../db/appRole';

/**
 * The app's database user (db/appRole.ts, docs/database-access.md). The whole integration suite
 * connects as it (globalSetup.ts); these tests check what it must NOT be able to do.
 */
describe('least-privilege database user (real Postgres)', () => {
  let owner: Client;

  beforeAll(async () => {
    owner = new Client({ connectionString: process.env.TEST_OWNER_DATABASE_URL });
    await owner.connect();
  });

  afterAll(async () => {
    await owner.end();
  });

  const refused = async (sql: string) => {
    await expect(db.query(sql)).rejects.toThrow(/permission denied|must be owner/);
  };

  it('is not the owner, and has no special rights', async () => {
    const [me] = await db.query<{ user: string; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
      'SELECT current_user AS user, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user'
    );
    expect(me).toMatchObject({ rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    const [{ owner: tableOwner }] = (await owner.query("SELECT tableowner AS owner FROM pg_tables WHERE tablename = 'tasks'")).rows;
    expect(me!.user).not.toBe(tableOwner);
  });

  it('cannot change the schema', async () => {
    await refused('DROP TABLE tasks');
    await refused('ALTER TABLE users ADD COLUMN is_root boolean');
    await refused('CREATE TABLE stash (x text)');
    await refused('TRUNCATE users');
    await refused('CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
  });

  it('can read the migration history but not rewrite it', async () => {
    expect((await db.query('SELECT version FROM schema_migrations')).length).toBeGreaterThan(0);
    await refused("INSERT INTO schema_migrations (version) VALUES ('999_fake.sql')");
    await refused('DELETE FROM schema_migrations');
  });

  it('can add to the audit log and prune it, but not edit it', async () => {
    await refused("UPDATE audit_log SET action = 'auth.login'");
    await refused('TRUNCATE audit_log');
    await expect(db.query("DELETE FROM audit_log WHERE created_at < NOW() - interval '10 years'")).resolves.toBeDefined();
  });

  it('refuses an app user that is the owner or has special rights', async () => {
    const ownerName = (await owner.query('SELECT current_user AS u')).rows[0].u as string;
    await expect(ensureAppRole(owner, { user: ownerName, password: 'x' }, ownerName)).rejects.toThrow(/same user/);
    await expect(ensureAppRole(owner, { user: ownerName, password: 'x' }, 'someone-else')).rejects.toThrow(/superuser/);
  });

  it('quotes the role name and password, so neither can inject SQL', () => {
    const [create] = appRoleStatements({ user: 'app"; DROP TABLE users; --', password: "p'w" }, false, 'openpm');
    expect(create).toBe(`CREATE ROLE "app""; DROP TABLE users; --" LOGIN PASSWORD 'p''w'`);
  });

  it('granting again (every migrate up) changes nothing and covers new tables', async () => {
    const user = (await db.query<{ u: string }>('SELECT current_user AS u'))[0]!.u;
    await owner.query('CREATE TABLE later_table (id int)');
    try {
      await ensureAppRole(owner, { user, password: '' }, 'someone-else');
      await expect(db.query('SELECT * FROM later_table')).resolves.toEqual([]);
    } finally {
      await owner.query('DROP TABLE later_table');
    }
  });
});
