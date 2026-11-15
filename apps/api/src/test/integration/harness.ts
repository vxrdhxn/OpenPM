import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { buildApp } from '../../app';
import { db } from '../../db/client';

export type App = FastifyInstance;

export async function startApp(): Promise<App> {
  const app = buildApp({ logger: false });
  await app.ready();
  return app;
}

export const unique = () => crypto.randomBytes(4).toString('hex');

export interface Actor {
  userId: string;
  orgId: string;
  role: string;
  email: string;
  /** Authorization header value for app.inject(). */
  auth: { authorization: string };
}

/** Register a new organization and its admin through the real API. */
export async function registerOrg(app: App, password = 'password123'): Promise<Actor> {
  const id = unique();
  const email = `admin-${id}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { org_name: `Org ${id}`, org_slug: `org-${id}`, email, password, name: `Admin ${id}` },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  const { token } = res.json();
  const claims = app.jwt.decode<{ user_id: string; org_id: string; role: string }>(token)!;
  return { userId: claims.user_id, orgId: claims.org_id, role: claims.role, email, auth: { authorization: `Bearer ${token}` } };
}

/**
 * Add a user with a given role to an organization. There is no role-change endpoint yet, so the row is
 * inserted directly; the token is signed with the app's real key, exactly as login would.
 */
export async function addUser(app: App, orgId: string, role: 'owner' | 'admin' | 'member' | 'viewer'): Promise<Actor> {
  const email = `${role}-${unique()}@example.com`;
  const [row] = await db.query<{ id: string }>(
    'INSERT INTO users (org_id, email, password_hash, name, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [orgId, email, await bcrypt.hash('password123', 4), `${role} user`, role]
  );
  const token = app.jwt.sign({ user_id: row!.id, org_id: orgId, role });
  return { userId: row!.id, orgId, role, email, auth: { authorization: `Bearer ${token}` } };
}

export async function createProject(app: App, actor: Actor, name = `Project ${unique()}`): Promise<{ id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/projects', headers: actor.auth, payload: { name } });
  if (res.statusCode !== 201) throw new Error(`create project failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

export async function createTask(
  app: App,
  actor: Actor,
  projectId: string,
  extra: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/tasks`,
    headers: actor.auth,
    payload: { title: `Task ${unique()}`, ...extra },
  });
  if (res.statusCode !== 201) throw new Error(`create task failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Read a row straight from the database, bypassing the API. */
export async function row<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T | undefined> {
  return (await db.query<T>(sql, params))[0];
}
