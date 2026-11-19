import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Job } from 'bullmq';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../config';
import { db } from '../../db/client';
import { jobs, waitForJob } from './fakes';
import { addUser, createProject, createTask, registerOrg, row, startApp, unique, type Actor, type App } from './harness';

/**
 * The worker's job handler (apps/worker/src/handler.ts) against real Postgres, on the jobs the real
 * API enqueues. Only email delivery is replaced, by a spy. The worker connects as the same
 * unprivileged database user as the API (DATABASE_URL from globalSetup).
 */
const workerSrc = (file: string) => path.resolve(__dirname, '../../../../worker/src', file);
const sent: Array<{ to: string; subject: string; body: string }> = [];
let handleJob: (job: Job) => Promise<void>;

beforeAll(async () => {
  vi.doMock(workerSrc('lib/email.ts'), () => ({
    sendEmailNotification: async (to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
    },
  }));
  ({ handleJob } = await import(/* @vite-ignore */ pathToFileURL(workerSrc('handler.ts')).href));
});

/** What BullMQ would hand the worker for a job the API queued. */
const asJob = (j: { name: string; data: Record<string, unknown> }, id = unique()) =>
  ({ id, name: j.name, data: j.data, opts: { attempts: 5 }, attemptsMade: 0, timestamp: Date.now() }) as unknown as Job;

describe('worker jobs (real Postgres)', () => {
  let app: App;
  let owner: Actor;

  beforeEach(async () => {
    sent.length = 0;
    app = await startApp();
    owner = await registerOrg(app);
  });

  afterEach(async () => {
    config.SIGNUP_VERIFICATION = 'auto';
    await app.close();
  });

  it('task_created emails the assignee, and nobody for an unassigned task', async () => {
    const ada = await addUser(app, owner.orgId, 'member');
    const projectId = (await createProject(app, owner)).id;
    const task = await createTask(app, owner, projectId, { title: 'Ship it', assignee_id: ada.userId });

    await handleJob(asJob(await waitForJob((j) => j.name === 'task_created' && j.data.task_id === task.id)));
    expect(sent).toEqual([expect.objectContaining({ to: ada.email })]);
    expect(sent[0]!.body).toContain('Ship it');

    sent.length = 0;
    const lonely = await createTask(app, owner, projectId);
    await handleJob(asJob(await waitForJob((j) => j.name === 'task_created' && j.data.task_id === lonely.id)));
    expect(sent).toEqual([]);
  });

  it('invite_created emails a link that the API then accepts', async () => {
    const email = `invitee-${unique()}@example.com`;
    await app.inject({ method: 'POST', url: '/api/invites', headers: owner.auth, payload: { email, role: 'member' } });

    await handleJob(asJob(await waitForJob((j) => j.name === 'invite_created' && j.data.org_id === owner.orgId)));
    expect(sent[0]!.to).toBe(email);
    const token = /token=([0-9a-f]{64})/.exec(sent[0]!.body)![1]!;

    const accepted = await app.inject({ method: 'POST', url: '/api/invites/accept', payload: { token, name: 'New Person', password: 'password123' } });
    expect(accepted.statusCode).toBe(201);
  });

  it('password_reset_requested emails a working link, and sends nothing once it is superseded', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: owner.email } });
    const first = await waitForJob((j) => j.name === 'password_reset_requested' && j.data.user_id === owner.userId);
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: owner.email } });
    await expect.poll(() => jobs.filter((j) => j.name === 'password_reset_requested' && j.data.user_id === owner.userId).length).toBe(2);

    await handleJob(asJob(first)); // the older link no longer works
    expect(sent).toEqual([]);

    const latest = jobs.filter((j) => j.name === 'password_reset_requested' && j.data.user_id === owner.userId).at(-1)!;
    await handleJob(asJob(latest));
    const token = /token=([0-9a-f]{64})/.exec(sent[0]!.body)![1]!;
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'a-new-password' } });
    expect(reset.statusCode).toBe(200);
  });

  it('signup jobs: the verification link creates the workspace; a taken address gets a notice instead', async () => {
    config.SIGNUP_VERIFICATION = 'required';
    const email = `signup-${unique()}@example.com`;
    const slug = `signup-${unique()}`;
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { org_name: 'Signup Co', org_slug: slug, email, password: 'password123', name: 'Sig' } });
    await expect.poll(async () => (await row('SELECT id FROM signup_requests WHERE email = $1', [email])) !== undefined, { timeout: 10_000 }).toBe(true);
    const { id } = (await row<{ id: string }>('SELECT id FROM signup_requests WHERE email = $1', [email]))!;

    await handleJob(asJob(await waitForJob((j) => j.name === 'signup_verification' && j.data.signup_id === id, 10_000)));
    const token = /token=([0-9a-f]{64})/.exec(sent[0]!.body)![1]!;
    expect((await app.inject({ method: 'POST', url: '/api/auth/verify-signup', payload: { token } })).statusCode).toBe(201);

    sent.length = 0;
    const again = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { org_name: 'Again', org_slug: `again-${unique()}`, email: owner.email, password: 'password123', name: 'Someone' } });
    expect(again.statusCode, again.body).toBe(202);
    await handleJob(asJob(await waitForJob((j) => j.name === 'signup_existing_account' && j.data.user_id === owner.userId, 10_000)));
    expect(sent).toEqual([expect.objectContaining({ to: owner.email, subject: 'You already have an OpenPM account' })]);
  });

  it('never acts on another organization: a job naming one org and another org’s rows does nothing', async () => {
    const other = await registerOrg(app);
    const ada = await addUser(app, owner.orgId, 'member');
    const projectId = (await createProject(app, owner)).id;
    const task = await createTask(app, owner, projectId, { assignee_id: ada.userId });

    await handleJob(asJob({ name: 'task_created', data: { task_id: task.id, org_id: other.orgId, assignee_id: ada.userId } }));
    await handleJob(asJob({ name: 'signup_existing_account', data: { user_id: ada.userId, org_id: other.orgId } }));
    expect(sent).toEqual([]);
  });

  it('runs the scheduled sweeps against the real schema', async () => {
    const ada = await addUser(app, owner.orgId, 'member');
    const projectId = (await createProject(app, owner)).id;
    const due = await createTask(app, owner, projectId, { assignee_id: ada.userId, due_date: new Date(Date.now() + 3_600_000).toISOString() });

    await handleJob(asJob({ name: 'due_reminders', data: {} }));
    expect(await row("SELECT 1 FROM notifications WHERE task_id = $1 AND type = 'due_soon'", [due.id])).toBeDefined();

    await db.query("UPDATE notifications SET created_at = NOW() - interval '400 days' WHERE task_id = $1", [due.id]);
    await handleJob(asJob({ name: 'notification_cleanup', data: {} }));
    expect(await row('SELECT 1 FROM notifications WHERE task_id = $1', [due.id])).toBeUndefined();
  });

  it('fails an unknown job retryably, and a malformed one permanently', async () => {
    await expect(handleJob(asJob({ name: 'from_the_future', data: {} }))).rejects.toThrow(/No processor/);
    await expect(handleJob(asJob({ name: 'invite_created', data: { invite_id: 'x' } }))).rejects.toMatchObject({ name: 'UnrecoverableError' });
  });
});
