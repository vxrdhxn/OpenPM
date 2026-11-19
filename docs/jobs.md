# Background jobs

The API enqueues jobs on one BullMQ queue, `tasks`, in Redis (`apps/api/src/queue.ts`). The worker
(`apps/worker`) consumes it. Every job today sends one email.

## Jobs

| Job | Enqueued by | Payload | Does |
| --- | --- | --- | --- |
| `task_created` | `POST /api/projects/:id/tasks` | `task_id`, `org_id`, `assignee_id`?, `request_id` | Emails the assignee, if there is one |
| `invite_created` | `POST /api/invites` | `invite_id`, `org_id`, `token`, `request_id` | Emails the invite link |
| `password_reset_requested` | `POST /api/auth/forgot-password` | `user_id`, `token`, `request_id` | Emails the reset link |

- **Tenant scope.** Every lookup for `task_created` and `invite_created` is filtered by the job's `org_id`. A job that names a row from another organization finds nothing and sends nothing. `password_reset_requested` is keyed by the user and must match the token hash.
- **Staleness.** Before sending, each job checks that its email still makes sense: the task and assignee still exist, and the invite or reset token is still current, unused and unexpired. Otherwise it completes without sending.
- **Secrets.** Jobs that carry a `token` are removed from Redis when they complete, and kept at most 24h (invites) or 1h (resets) after a final failure. Job data is never logged.

## Retries

Defaults are set on the queue (`DEFAULT_JOB_OPTIONS`):

- **Attempts and backoff:** 5 attempts with exponential backoff. Waits are 30 s, 1 min, 2 min and 4 min (about 7.5 min in total), well inside the shortest link lifetime (reset links last 1 h).
- **Concurrency:** 5 jobs at once per worker (`WORKER_CONCURRENCY`).
- **Timeout:** each email provider call is abandoned after 15 s. That attempt then fails and is retried.
- **Trimming:** completed jobs are kept 24 h (at most 1000); failed jobs are kept 7 days.

| Failure | Retried? |
| --- | --- |
| Postgres/Redis error, network error or timeout reaching the email provider, provider rate limit or 5xx | Yes |
| Provider rejects the message permanently (invalid recipient, invalid API key, invalid from address, ...) | No (`UnrecoverableError`) |
| Malformed payload (missing or non-string field) | No (`UnrecoverableError`) |
| Unknown job name (e.g. a new API with an old worker mid-deploy) | Yes, so an updated worker can take it |
| No `RESEND_API_KEY` configured | Not a failure: counted as `emails_total{result="skipped"}` |

**No duplicate emails.** Each send carries an idempotency key, `openpm/<job name>/<job id>/<enqueued at>`. The key is the same for every retry of a job, and the provider sends each key at most once within 24 h. So a retry after a timeout, or after a worker crash mid-send, cannot deliver a second copy.

## Configuration

The worker checks its environment at startup (`apps/worker/src/config.ts`) and exits with a list of every invalid variable rather than starting with silent fallbacks:

| Variable | Default | Rule |
| --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL` | local development servers | URLs |
| `APP_URL` | `http://localhost:3001` | URL; **required when `NODE_ENV=production`**, so emails never carry localhost links |
| `WORKER_CONCURRENCY` | `5` | positive whole number |
| `METRICS_PORT` | `9100` | port number |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |
| `RESEND_API_KEY` | unset (emails not sent) | |
| `EMAIL_FROM_ADDRESS` | `notifications@openpm.local` | email address |

Blank values (as in a freshly copied `.env.example`) count as unset, except for the connection URLs.

## Watching it

- `worker_jobs_total{status}` counts each attempt:
  - `completed`: the attempt succeeded.
  - `retrying`: the attempt failed and another is scheduled.
  - `failed`: the job gave up. This alerts (`OpenPMJobsFailing`).
- Worker logs carry `job_id`, `job_name` and the originating `request_id`:
  - `Job attempt failed; will retry` (warn)
  - `Job failed permanently` (error)
- Queue depth and lag: `worker_queue_jobs{state}` and `worker_queue_oldest_waiting_age_seconds` (see [observability.md](observability.md)).

## Recovering jobs

Failed jobs stay in the queue's failed set for 7 days. Retry them once the cause is fixed, e.g. after correcting `RESEND_API_KEY`. Run this from a shell with access to Redis, such as a worker pod:

```bash
node -e "
const { Queue } = require('bullmq');
const q = new Queue('tasks', { connection: { url: process.env.REDIS_URL } });
q.getFailed(0, 1000)
  .then(jobs => Promise.all(jobs.map(j => j.retry())))
  .then(r => { console.log('retried', r.length); return q.close(); });
"
```

Retrying is safe. Each job re-checks that its email is still current, and the idempotency key stops a second copy of anything already sent. Retried invite and reset jobs whose links have expired complete without sending. Ask the user to request a new link.

**Stuck jobs.** If a worker dies mid-job, BullMQ notices the lost lock (about 30 s) and moves the job back to waiting. No action is needed. If jobs are waiting but nothing is processed (`OpenPMWorkerNotProcessing`), check that worker pods are running and can reach Redis.
