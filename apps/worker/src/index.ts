import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load env for local dev (ignored in K8s)
dotenv.config({ path: '../../.env' });

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://openpm:openpm@localhost:5432/openpm',
});

// Helper for sending fake email
async function sendEmailNotification(email: string, subject: string, body: string) {
  console.log(`\n[EMAIL] To: ${email}`);
  console.log(`[EMAIL] Subject: ${subject}`);
  console.log(`[EMAIL] Body: ${body}\n`);
  // Simulate network latency
  await new Promise(resolve => setTimeout(resolve, 500));
}

const worker = new Worker('tasks', async (job: Job) => {
  console.log(`Processing job ${job.id} of type ${job.name}...`);

  if (job.name === 'task_created') {
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

}, { connection: redisConnection });

worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job?.id} has failed with ${err.message}`);
});

console.log('Worker is running and listening to "tasks" queue...');

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down worker...');
  await worker.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
