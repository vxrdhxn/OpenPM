# Incident response

What to do when OpenPM is down, degraded or attacked. This page holds the decisions and the first
steps; it links to the detailed procedures (rollback, restore, job recovery).

## Severity

| Level | Meaning | Examples | Response |
| --- | --- | --- | --- |
| **SEV1** | Users cannot work, or data is at risk | API down, 5xx over 5%, database errors, a suspected breach, data lost | Now, any hour. One incident lead; others help when asked. |
| **SEV2** | Working, but degraded | Slow API, live updates or emails not arriving, jobs stalled, no backup for a day | Same working day |
| **SEV3** | A warning sign | Rate limiting, Redis slow, failed logins rising, storage refusing deletes | Next working day; look for a trend |

Critical alerts are SEV1 or SEV2; warning alerts are SEV2 or SEV3.

## The first ten minutes

1. **Say you are on it** where your team coordinates, with the time and what you see. From now on
   you are the incident lead until you hand it over.
2. **Look at the dashboards**, in this order: *OpenPM / API* (traffic, 5xx, latency, dependencies),
   *OpenPM / Infrastructure* (restarts, replicas, volumes), *OpenPM / Worker and queue*
   (`docs/observability.md`).
3. **Ask: did anything change?** A deploy, a config or Secret change, a provider incident. **If a
   deploy started it, roll back first and investigate after** (*Rolling back* in
   `docs/releasing.md`: revert the deploy PR, sync `openpm-prod`).
4. **Find one failing request.** Every response carries `X-Request-Id`, and the same id is on every
   log line of that request and of the jobs it queued. Search the logs for it.
5. **Write down what you do, with times,** as you go. It becomes the timeline for the review.

## Alerts and what to do

| Alert | First check | Likely fix |
| --- | --- | --- |
| `OpenPMApiDown`, `OpenPMApiTargetMissing` | `kubectl -n openpm get pods`, `describe` and `logs --previous` of the API pods; the startup log names an invalid setting | Fix the setting or Secret; roll back a bad release; a crash loop after a migration means the migration failed (init container `migrate` logs) |
| `OpenPMApiHighErrorRate` | 5xx by route on the API dashboard; logs at level `error` | Roll back if new. If a dependency: see below |
| `OpenPMDbQueryErrors`, `OpenPMDbPoolExhausted` | Database health with your provider, or the `postgres` pod; slow queries (`docs/load-testing.md`) | Restore connectivity; kill a runaway query; scale the database. The API answers 503 with `Retry-After` meanwhile, and recovers on its own |
| `OpenPMApiOverloaded`, `OpenPMApiHighLatency`, `OpenPMEventLoopLag` | Requests/s and CPU; HPA at `maxReplicas`? | Raise `api.hpa.maxReplicas` or the pod's resources; find the expensive route (p95 by route) |
| `OpenPMRedisErrors`, `OpenPMRedisSlow`, `OpenPMJobsNotQueued` | Redis pod or provider; memory against `maxmemory` | Redis back up = everything recovers (cache is skipped, events resume, queued invalidations replay). At `maxmemory`, writes fail by design (`noeviction`): grow it, or drain the queue |
| `OpenPMWorkerDown`, `OpenPMWorkerNotProcessing`, `OpenPMQueueStalled`, `OpenPMQueueLagHigh` | Worker pods and logs; Redis | Restart or scale the worker. Jobs wait in Redis and run once it is back. See *Recovering jobs* in `docs/jobs.md` |
| `OpenPMJobsFailing`, `OpenPMEmailsFailing` | The job's error in the worker log (`job_name`, `request_id`) | Email: the provider's status, `RESEND_API_KEY`, the from address. Failed jobs are kept 7 days and can be retried (`docs/jobs.md`) |
| `OpenPMBackupMissing` | `kubectl -n openpm get jobs`, logs of the last `postgres-backup` job; the backup volume's free space | Fix the cause, then run one now: `kubectl -n openpm create job backup-now --from=cronjob/openpm-postgres-backup` |
| `OpenPMStorageDeletionsOwed` | API logs for `Could not delete an attachment object` | Storage credentials or bucket permissions. The owed deletions are retried by themselves once fixed (`docs/attachments.md`) |
| `OpenPMWebsocketErrors` | Ingress controller logs, proxy idle timeouts | Proxy timeouts above 30 s for `/ws` (`values.yaml`, `ingress`) |
| `OpenPMLoginFailuresHigh`, `OpenPMApiRateLimiting` | Failed sign-ins by workspace in the security log; 429s by route | Rate limits already slow this down. For a sustained attack, block the source at the edge. See *Security incidents* below |

## Security incidents

Treat any of these as **SEV1**: an account used by someone else, a leaked secret, data seen by
someone who should not see it.

- **Stop it first.**
  - *One account:* reset its password (`POST /api/auth/forgot-password`, or have an admin remove and
    re-invite the member). Either ends every session of that user at once.
  - *Everyone's sessions:* rotate `JWT_SECRET`, then restart the API. Every token stops working and
    everyone signs in again.
  - *Database or Redis credentials:* rotate them (*Upgrading an install made with the old defaults*
    in `docs/deploying.md` has the commands), then restart the API and worker.
  - *Email provider key:* revoke it with the provider, set a new `RESEND_API_KEY`, restart the
    worker.
- **Find out what happened.** The security audit log (Settings → Security log, or `GET
  /api/audit`) has sign-ins, failures, password changes and every change to who may see what, with
  IP address and device, kept for a year (`docs/audit-log.md`). The activity feed has the product
  changes. Logs have request ids and IPs for 30 days.
- **Keep evidence.** Export the relevant audit and log entries before retention deletes them.
- **Tell people.** If personal data was exposed, the people affected (and, depending on where you
  operate, a regulator) may have to be told within a fixed time, often 72 hours. Decide early
  (`docs/privacy.md` lists what OpenPM stores).

Report vulnerabilities in OpenPM itself as described in `SECURITY.md`.

## Recovery procedures

| Situation | Procedure |
| --- | --- |
| A release broke something | *Rolling back* in `docs/releasing.md` (revert the deploy PR, sync). The database is not rolled back; read *The database is not rolled back* first if the release had a migration. |
| Data deleted or corrupted | *Restore* in `docs/backup-restore.md`, from the provider's point-in-time recovery or the newest dump. Restoring rewinds **everything** to that moment: say so before you do it. |
| Lost cluster | Recreate it, install the chart with the same values and Secret, restore the database, sync. Rehearsed on kind (`docs/rehearsal.md`). |
| Jobs lost, stuck or failed | *Recovering jobs* in `docs/jobs.md`. |
| Redis lost | Nothing to restore: the cache refills, events resume, and only jobs that were waiting are lost. Their emails can be sent again: invite again, request a new reset link. |
| Attachment files lost | Restore the bucket from the provider's versioning or backup. Rows without files fail to download; they can be deleted in the app. |

What the system does by itself, measured in failure tests (`docs/load-testing.md`): a Postgres
restart costs 503s for its duration and no crash. A Redis outage costs no failed requests, only the
cache and live events. A killed worker loses no job. A deleted API pod is replaced, and the others
keep serving.

## After the incident

Within a week, write a short review **without blame**:

- the timeline (from your notes),
- the impact (who, for how long, what was lost),
- what caused it and what made it worse,
- what went well,
- the follow-ups, each with an owner: a fix, an alert that would have fired earlier, a test that
  would have caught it.

Then add anything this page should have said.
