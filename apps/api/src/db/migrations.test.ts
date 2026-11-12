import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listMigrations, migrateDown, migrateUp, migrationStatus, Queryable } from './migrations';

/** In-memory stand-in for a pg client that tracks schema_migrations and executed SQL. */
class FakeClient implements Queryable {
  applied: string[] = [];
  executed: string[] = [];
  failOn: string | null = null;
  locked = false;

  async query(text: string, params: unknown[] = []) {
    const sql = text.trim();
    if (sql.startsWith('SELECT pg_advisory_lock')) this.locked = true;
    else if (sql.startsWith('SELECT pg_advisory_unlock')) this.locked = false;
    else if (sql.startsWith('SELECT version FROM schema_migrations')) {
      return { rows: [...this.applied].sort().map((version) => ({ version })) };
    } else if (sql.startsWith('INSERT INTO schema_migrations')) this.applied.push(params[0] as string);
    else if (sql.startsWith('DELETE FROM schema_migrations')) {
      this.applied = this.applied.filter((v) => v !== params[0]);
    } else if (!/^(BEGIN|COMMIT|ROLLBACK|CREATE TABLE IF NOT EXISTS schema_migrations)/.test(sql)) {
      if (this.failOn && sql.includes(this.failOn)) throw new Error('boom');
      this.executed.push(sql);
    }
    return { rows: [] };
  }
}

const quiet = () => undefined;

describe('migration engine', () => {
  let dir: string;
  let client: FakeClient;

  const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
    client = new FakeClient();
    write('001_a.sql', 'CREATE TABLE a;');
    write('001_a.down.sql', 'DROP TABLE a;');
    write('002_b.sql', 'CREATE TABLE b;');
    write('002_b.down.sql', 'DROP TABLE b;');
    write('003_c.sql', 'CREATE TABLE c;');
    write('003_c.down.sql', 'DROP TABLE c;');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('listMigrations', () => {
    it('pairs up/down files, orders by name and never treats .down.sql as an up migration', () => {
      const list = listMigrations(dir);
      expect(list.map((m) => m.version)).toEqual(['001_a.sql', '002_b.sql', '003_c.sql']);
      expect(list.every((m) => m.downPath !== null)).toBe(true);
    });

    it('reports a missing down file and tolerates a missing directory', () => {
      fs.rmSync(path.join(dir, '002_b.down.sql'));
      expect(listMigrations(dir)[1]?.downPath).toBeNull();
      expect(listMigrations(path.join(dir, 'nope'))).toEqual([]);
    });
  });

  describe('migrateUp', () => {
    it('applies all pending migrations in order and records them', async () => {
      const ran = await migrateUp(client, dir, quiet);
      expect(ran).toEqual(['001_a.sql', '002_b.sql', '003_c.sql']);
      expect(client.executed).toEqual(['CREATE TABLE a;', 'CREATE TABLE b;', 'CREATE TABLE c;']);
      expect(client.applied).toEqual(ran);
    });

    it('is idempotent and only runs what is pending', async () => {
      client.applied = ['001_a.sql'];
      const ran = await migrateUp(client, dir, quiet);
      expect(ran).toEqual(['002_b.sql', '003_c.sql']);
      expect(await migrateUp(client, dir, quiet)).toEqual([]);
    });

    it('stops at a failing migration, does not record it and releases the lock', async () => {
      client.failOn = 'TABLE b';
      await expect(migrateUp(client, dir, quiet)).rejects.toThrow('boom');
      expect(client.applied).toEqual(['001_a.sql']);
      expect(client.locked).toBe(false);
    });
  });

  describe('migrateDown', () => {
    beforeEach(async () => {
      await migrateUp(client, dir, quiet);
      client.executed = [];
    });

    it('rolls back only the latest migration by default', async () => {
      expect(await migrateDown(client, dir, 1, quiet)).toEqual(['003_c.sql']);
      expect(client.executed).toEqual(['DROP TABLE c;']);
      expect(client.applied).toEqual(['001_a.sql', '002_b.sql']);
    });

    it('rolls back N migrations newest-first', async () => {
      expect(await migrateDown(client, dir, 2, quiet)).toEqual(['003_c.sql', '002_b.sql']);
      expect(client.executed).toEqual(['DROP TABLE c;', 'DROP TABLE b;']);
      expect(client.applied).toEqual(['001_a.sql']);
    });

    it('is safe when asked for more steps than are applied', async () => {
      expect(await migrateDown(client, dir, 10, quiet)).toHaveLength(3);
      expect(client.applied).toEqual([]);
      expect(await migrateDown(client, dir, 1, quiet)).toEqual([]);
    });

    it('refuses before changing anything if a targeted migration has no down file', async () => {
      fs.rmSync(path.join(dir, '002_b.down.sql'));
      await expect(migrateDown(client, dir, 2, quiet)).rejects.toThrow(/002_b\.sql: no \.down\.sql/);
      expect(client.executed).toEqual([]);
      expect(client.applied).toHaveLength(3);
      expect(client.locked).toBe(false);
    });

    it('refuses when an applied migration file is missing from disk', async () => {
      client.applied.push('099_ghost.sql');
      await expect(migrateDown(client, dir, 1, quiet)).rejects.toThrow(/099_ghost\.sql: migration file not found/);
    });

    it('rejects invalid step counts', async () => {
      for (const bad of [0, -1, 1.5, NaN]) {
        await expect(migrateDown(client, dir, bad, quiet)).rejects.toThrow(/positive integer/);
      }
    });
  });

  describe('migrationStatus', () => {
    it('shows applied and reversible flags', async () => {
      client.applied = ['001_a.sql'];
      fs.rmSync(path.join(dir, '003_c.down.sql'));
      expect(await migrationStatus(client, dir)).toEqual([
        { version: '001_a.sql', applied: true, reversible: true },
        { version: '002_b.sql', applied: false, reversible: true },
        { version: '003_c.sql', applied: false, reversible: false },
      ]);
    });
  });

  describe('real migrations', () => {
    it('every shipped migration has a rollback', () => {
      const real = listMigrations(path.join(__dirname, 'migrations'));
      expect(real.length).toBeGreaterThan(0);
      expect(real.filter((m) => !m.downPath).map((m) => m.version)).toEqual([]);
    });

    it('every table/index an up migration creates is dropped by its rollback', () => {
      // An index counts as covered if it is dropped explicitly OR its table is dropped.
      const created = /CREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?(\w+)(?:\s+ON\s+(\w+))?/gi;
      const drops = (down: string, kind: string, name: string) =>
        new RegExp(String.raw`DROP\s+${kind}\s+(?:IF EXISTS\s+)?${name}\b`, 'i').test(down);
      const problems: string[] = [];

      for (const m of listMigrations(path.join(__dirname, 'migrations'))) {
        const up = fs.readFileSync(m.upPath, 'utf8');
        const down = fs.readFileSync(m.downPath!, 'utf8');
        for (const [, kind, name, table] of up.matchAll(created)) {
          const covered = drops(down, kind!, name!) || (kind!.toUpperCase() === 'INDEX' && drops(down, 'TABLE', table!));
          if (!covered) problems.push(`${m.version}: ${kind} ${name} is not dropped by its rollback`);
        }
      }
      expect(problems).toEqual([]);
    });
  });
});
