import { Job } from 'bullmq';
import { pool } from '../lib/db';
import { sendEmailNotification } from '../lib/email';

export default async function processTaskCreated(job: Job) {
  const { task_id, assignee_id, org_id: _org_id } = job.data;

  // If no assignee, nothing to notify
  if (!assignee_id) {
    console.log(`Task ${task_id} has no assignee. Skipping notification.`);
    return;
  }

  const client = await pool.connect();
  try {
    // Get task details
    const taskRes = await client.query('SELECT title, project_id FROM tasks WHERE id = $1', [task_id]);
    if (taskRes.rows.length === 0) return;
    const taskTitle = taskRes.rows[0].title;
    const projectId = taskRes.rows[0].project_id;

    // Get assignee email
    const userRes = await client.query('SELECT name, email FROM users WHERE id = $1', [assignee_id]);
    if (userRes.rows.length === 0) return;
    const { name, email } = userRes.rows[0];

    // Get project name
    const projRes = await client.query('SELECT name FROM projects WHERE id = $1', [projectId]);
    const projName = projRes.rows.length > 0 ? projRes.rows[0].name : 'Unknown Project';

    await sendEmailNotification(
      email,
      `You've been assigned a new task: ${taskTitle}`,
      `Hi ${name},\n\nYou have been assigned to "${taskTitle}" in the project "${projName}".\nLog in to OpenPM to view it.`
    );
    
    console.log(`Successfully processed task_created for task ${task_id}`);
  } finally {
    client.release();
  }
}
