# Automatic Alliance Sync Scheduler

Alliance sync configurations, run history, leases, and seen-player state are stored in Supabase PostgreSQL. Each enabled configuration is due when `next_run_at <= now()`. The Cloudflare Worker claims configurations through the Supabase lease RPC, validates a fresh MightPulse roster, skips players already registered in Supabase, and schedules the next normal run 24 hours later. Failed manual runs are scheduled for retry after five minutes.

## Runtime and cadence

Supabase `pg_cron` is the scheduler of record. `pg_net` sends authenticated HTTP requests to the Cloudflare Worker:

| Job | Schedule | Purpose |
|---|---|---|
| `kingshot-auto-redeem` | `* * * * *` | Auto-redemption coordinator |
| `alliance-sync-worker` | `0 11 * * *` | Due alliance roster syncs |
| `alliance-manual-registration-queue` | `*/5 * * * *` | Resume durable manual-registration jobs |
| `scheduled-announcement-worker` | `*/5 * * * *` | Deliver due scheduled announcements |
| `purge-kingshot-visitor-telemetry` | `17 3 * * *` | Database-local visitor telemetry retention cleanup |

The alliance worker processes bounded batches. Player outcomes are persisted in `alliance_sync_seen_players`; if more members remain, the configuration is released with a five-minute continuation time and the next wake-up resumes from those outcomes. Departure reconciliation runs only after the entire fresh roster has been traversed. A completed sync advances its next run by 24 hours.

The GitHub Actions workflow `.github/workflows/alliance-sync-scheduler.yml` is manual-dispatch only. It is not a scheduled trigger and does not compete with `pg_cron`. Vercel is not part of the runtime or scheduler path; the previous address is reserved for a separate temporary redirect during the domain transition.

## Secrets

The Cloudflare Worker has the private `ALLIANCE_SYNC_CRON_SECRET` and `CRON_SECRET` bindings. The corresponding values are stored in the private Supabase scheduler configuration and are never printed in logs or committed to the repository.

For the optional manual GitHub Actions workflow, configure the repository Actions secret `ALLIANCE_SYNC_CRON_SECRET` to match the Worker binding. This is only needed for manual operator-triggered runs, not for the Supabase schedule.

## Verify

1. Inspect `cron.job` and confirm the jobs above are active and their commands target `https://app.ks-redeemer.workers.dev`.
2. Inspect `cron.job_run_details` for recent successful scheduler invocations.
3. Inspect `net._http_response` for the HTTP responses produced by `pg_net`; a successful cron enqueue alone does not prove the Worker returned a successful response.
4. In the Admin Alliance Sync page, confirm each enabled alliance has a recent attempt and an updated next-run time.
5. The database's per-alliance lease prevents overlapping work across invocations, including an optional manual dispatch.

The cutover is defined in `ops/cloudflare-pg-cron-cutover.sql`. It preserves the existing private scheduler tokens and schedules while changing the application origin. Apply it only after the Cloudflare Worker is deployed and its read-only smoke tests pass.
