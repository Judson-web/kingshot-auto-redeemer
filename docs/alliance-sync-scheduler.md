# Automatic Alliance Sync Scheduler

Alliance sync configurations are stored in the Alliance Sync Neon database. Each enabled configuration is due when `next_run_at <= now()`. The worker uses a lease per configuration, validates a fresh MightPulse roster, skips players already registered in Supabase, and schedules the next normal run 24 hours later. Failed syncs use exponential backoff.

## Why this scheduler exists

Vercel Hobby cron is limited to daily schedules, which is too infrequent for the worker's five-minute failure retry/backoff. The GitHub Actions workflow `.github/workflows/alliance-sync-scheduler.yml` wakes the existing server-side worker every five minutes. It does not perform registration in GitHub; all roster validation and registration remain in the existing server-side worker.

## One-time secret configuration

In GitHub, open **Settings → Secrets and variables → Actions → New repository secret** and add:

- Name: `ALLIANCE_SYNC_CRON_SECRET`
- Value: the same secret configured on the Vercel production project as `ALLIANCE_SYNC_CRON_SECRET` or `CRON_SECRET`.

The workflow supports either GitHub secret name, `ALLIANCE_SYNC_CRON_SECRET` or `CRON_SECRET`. Keep the value private and do not commit it to the repository. The worker rejects requests without the matching bearer token.

## Verify

1. Open **Actions → Alliance Sync Scheduler → Run workflow** to test the connection.
2. A successful run returns JSON from the worker with `ok: true` and a `results` array. A run with no due configurations is healthy and expected.
3. In the Admin Alliance Sync page, confirm each enabled alliance has a recent attempt and an updated next-run time.
4. The workflow is serialized with a concurrency group, and the database's per-alliance lease prevents overlapping work across invocations.

GitHub scheduled workflows are best-effort and can be delayed by GitHub. They are not a hard real-time scheduler. The existing Vercel daily cron remains as a backup wake-up. No Neon `pg_cron` HTTP extension is required.
