import { Job } from 'bullmq';
import { pool } from '../lib/db';
import { sendEmailNotification } from '../lib/email';
import { logger, Logger } from '../lib/logger';
import { jobIdempotencyKey, optionalField, requireFields } from '../lib/jobs';

/**
 * Email the assignee of a newly created task. `log` is the per-job logger from handleJob (it already
 * carries job_id and request_id).
 *
 * Every lookup is scoped to the job's org_id: a job naming a task or user from another organization
 * finds nothing and sends nothing.
 */
export default async function processTaskCreated(job: Job, log: Logger = logger) {
  const { task_id, org_id } = requireFields(job, ['task_id', 'org_id']);
  const assignee_id = optionalField(job, 'assignee_id');

  // If no assignee, nothing to notify
  if (!assignee_id) {
    log.info({ task_id }, 'Task has no assignee; skipping notification');
    return;
  }

  const client = await pool.connect();
  try {
    const taskRes = await client.query(
      `SELECT t.title, p.name AS project_name
         FROM tasks t
         JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
        WHERE t.id = $1 AND t.org_id = $2`,
      [task_id, org_id]
    );
    if (taskRes.rows.length === 0) {
      log.warn({ task_id }, 'Task no longer exists; skipping notification');
      return;
    }
    const { title: taskTitle, project_name: projName } = taskRes.rows[0];

    const userRes = await client.query('SELECT name, email FROM users WHERE id = $1 AND org_id = $2', [assignee_id, org_id]);
    if (userRes.rows.length === 0) {
      log.warn({ task_id, assignee_id }, 'Assignee no longer exists in this organization; skipping notification');
      return;
    }
    const { name, email } = userRes.rows[0];

    await sendEmailNotification(
      email,
      `You've been assigned a new task: ${String(taskTitle).replace(/[\r\n]+/g, ' ')}`,
      `Hi ${name},\n\nYou have been assigned to "${taskTitle}" in the project "${projName}".\nLog in to OpenPM to view it.`,
      log,
      { idempotencyKey: jobIdempotencyKey(job) }
    );

    log.info({ task_id, assignee_id }, 'Processed task_created');
  } finally {
    client.release();
  }
}
